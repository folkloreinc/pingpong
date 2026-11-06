import type { Selectable } from 'kysely';

import { validate } from '@pingpong-io/protocol';

import type { Limits } from '../config.ts';
import { decryptSecret, encryptSecret, randomToken } from '../crypto.ts';
import type { Database } from '../database/connection.ts';
import type { ProjectsTable } from '../database/tables.ts';
import { ConflictError, InvalidValueError, NotFoundError } from '../errors.ts';

export interface Project {
    id: string;
    name: string;
    /** The public key (`pk_…`). */
    key: string;
    /** The secrets that sign requests and channels: the current one, then the previous one until it expires. */
    secrets: string[];
    previousSecretExpiresAt: Date | undefined;
    origins: string[];
    /** The limits that apply: the project's own, or the server's defaults. */
    limits: Limits;
    /** The limits the project sets itself. */
    ownLimits: Partial<Limits>;
    disabled: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface ProjectInput {
    name?: string;
    origins?: string[];
    /** A limit set to null goes back to the server's default. */
    limits?: { [K in keyof Limits]?: number | null };
    disabled?: boolean;
}

const LIMIT_COLUMNS = {
    maxConnections: 'max_connections',
    maxMessagesPerSecond: 'max_messages_per_second',
    maxMessageSize: 'max_message_size',
    maxChannelsPerSocket: 'max_channels_per_socket',
} as const satisfies Record<keyof Limits, keyof ProjectsTable>;

type Row = Selectable<ProjectsTable>;

function readDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
}

export function validateProjectId(id: string): void {
    if (!validate('ProjectId', id).valid) {
        throw new InvalidValueError(
            `"${id}" is not a valid project id: lower-case letters, digits and dashes, starting with a letter or a digit, up to 63 characters.`,
        );
    }
}

export function validateOrigins(origins: string[]): void {
    const result = validate('Origins', { origins });
    if (!result.valid) {
        const invalid = origins.filter((origin) => !validate('Origin', origin).valid);
        throw new InvalidValueError(
            invalid.length > 0
                ? `Not an origin: ${invalid.join(', ')}. An origin is a scheme and a host, with an optional port and no path (https://example.com, https://*.example.com).`
                : 'Origins must be unique, and at most 100.',
        );
    }
}

function validateLimits(limits: ProjectInput['limits']): void {
    for (const [name, value] of Object.entries(limits ?? {})) {
        if (!(name in LIMIT_COLUMNS)) {
            throw new InvalidValueError(`Unknown limit: ${name}.`);
        }
        if (value !== null && (!Number.isInteger(value) || (value as number) < 1)) {
            throw new InvalidValueError(`${name} must be a positive integer.`);
        }
    }
}

/**
 * The projects, in the database. Secrets are encrypted with `PINGPONG_SECRET_KEY` and only
 * decrypted when a project is read.
 */
export class Projects {
    readonly #database: Database;
    readonly #secretKey: Buffer;
    readonly #defaults: Limits;
    readonly #now: () => Date;

    constructor(database: Database, secretKey: Buffer, defaults: Limits, now = () => new Date()) {
        this.#database = database;
        this.#secretKey = secretKey;
        this.#defaults = defaults;
        this.#now = now;
    }

    #toProject(row: Row): Project {
        const now = this.#now();
        const previousExpiresAt =
            row.previous_secret_expires_at === null
                ? undefined
                : readDate(row.previous_secret_expires_at);
        const previousValid =
            row.previous_secret !== null &&
            previousExpiresAt !== undefined &&
            previousExpiresAt > now;
        const ownLimits: Partial<Limits> = {};
        for (const [name, column] of Object.entries(LIMIT_COLUMNS) as [keyof Limits, keyof Row][]) {
            const value = row[column];
            if (value !== null && value !== undefined) {
                ownLimits[name] = Number(value);
            }
        }
        return {
            id: row.id,
            name: row.name,
            key: row.key,
            secrets: [
                decryptSecret(this.#secretKey, row.secret),
                ...(previousValid && row.previous_secret !== null
                    ? [decryptSecret(this.#secretKey, row.previous_secret)]
                    : []),
            ],
            previousSecretExpiresAt: previousValid ? previousExpiresAt : undefined,
            origins: JSON.parse(row.origins) as string[],
            limits: { ...this.#defaults, ...ownLimits },
            ownLimits,
            disabled: row.disabled_at !== null,
            createdAt: readDate(row.created_at),
            updatedAt: readDate(row.updated_at),
        };
    }

    async list(): Promise<Project[]> {
        const rows = await this.#database.kysely
            .selectFrom('projects')
            .selectAll()
            .orderBy('id')
            .execute();
        return rows.map((row) => this.#toProject(row));
    }

    async find(id: string): Promise<Project | undefined> {
        const row = await this.#database.kysely
            .selectFrom('projects')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        return row === undefined ? undefined : this.#toProject(row);
    }

    async findByKey(key: string): Promise<Project | undefined> {
        const row = await this.#database.kysely
            .selectFrom('projects')
            .selectAll()
            .where('key', '=', key)
            .executeTakeFirst();
        return row === undefined ? undefined : this.#toProject(row);
    }

    async get(id: string): Promise<Project> {
        const project = await this.find(id);
        if (project === undefined) {
            throw new NotFoundError(`No project "${id}".`);
        }
        return project;
    }

    /** Creates a project. The secret is only returned here and by `rotateSecret()`. */
    async create(
        id: string,
        input: ProjectInput = {},
    ): Promise<{ project: Project; secret: string }> {
        validateProjectId(id);
        validateOrigins(input.origins ?? []);
        validateLimits(input.limits);
        if ((await this.find(id)) !== undefined) {
            throw new ConflictError(`The project "${id}" already exists.`);
        }
        const secret = randomToken('sk_');
        const now = this.#now();
        const limits = input.limits ?? {};
        await this.#database.kysely
            .insertInto('projects')
            .values({
                id,
                name: input.name ?? id,
                key: randomToken('pk_', 18),
                secret: encryptSecret(this.#secretKey, secret),
                origins: JSON.stringify(input.origins ?? []),
                max_connections: limits.maxConnections ?? null,
                max_messages_per_second: limits.maxMessagesPerSecond ?? null,
                max_message_size: limits.maxMessageSize ?? null,
                max_channels_per_socket: limits.maxChannelsPerSocket ?? null,
                created_at: now,
                updated_at: now,
                disabled_at: input.disabled === true ? now : null,
            })
            .execute();
        return { project: await this.get(id), secret };
    }

    async update(id: string, input: ProjectInput): Promise<Project> {
        const project = await this.get(id);
        if (input.origins !== undefined) {
            validateOrigins(input.origins);
        }
        validateLimits(input.limits);
        const now = this.#now();
        const limits: Partial<Record<(typeof LIMIT_COLUMNS)[keyof Limits], number | null>> = {};
        for (const [name, value] of Object.entries(input.limits ?? {})) {
            limits[LIMIT_COLUMNS[name as keyof Limits]] = value;
        }
        await this.#database.kysely
            .updateTable('projects')
            .set({
                ...(input.name === undefined ? {} : { name: input.name }),
                ...(input.origins === undefined ? {} : { origins: JSON.stringify(input.origins) }),
                ...limits,
                ...(input.disabled === undefined || input.disabled === project.disabled
                    ? {}
                    : { disabled_at: input.disabled ? now : null }),
                updated_at: now,
            })
            .where('id', '=', id)
            .execute();
        return this.get(id);
    }

    /**
     * Gives the project a new secret. The previous one stays valid for `gracePeriod` seconds, so the
     * application can deploy the new one first. A second rotation within the grace period drops the
     * secret before the current one.
     */
    async rotateSecret(
        id: string,
        gracePeriod: number,
    ): Promise<{ project: Project; secret: string }> {
        const project = await this.get(id);
        const row = await this.#database.kysely
            .selectFrom('projects')
            .select('secret')
            .where('id', '=', id)
            .executeTakeFirstOrThrow();
        const secret = randomToken('sk_');
        const now = this.#now();
        await this.#database.kysely
            .updateTable('projects')
            .set({
                secret: encryptSecret(this.#secretKey, secret),
                previous_secret: gracePeriod > 0 ? row.secret : null,
                previous_secret_expires_at:
                    gracePeriod > 0 ? new Date(now.getTime() + gracePeriod * 1000) : null,
                updated_at: now,
            })
            .where('id', '=', project.id)
            .execute();
        return { project: await this.get(id), secret };
    }

    async delete(id: string): Promise<void> {
        const result = await this.#database.kysely
            .deleteFrom('projects')
            .where('id', '=', id)
            .executeTakeFirst();
        if (result.numDeletedRows === 0n) {
            throw new NotFoundError(`No project "${id}".`);
        }
    }
}

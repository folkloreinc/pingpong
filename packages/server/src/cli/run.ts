import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';
import { createClient } from 'redis';

import { runChecks } from '../checks.ts';
import { ConfigError, loadConfig, requireSecretKey } from '../config.ts';
import type { Config, Limits } from '../config.ts';
import { createDatabase } from '../database/connection.ts';
import type { Database } from '../database/connection.ts';
import { migrateToLatest, pendingMigrations } from '../database/migrate.ts';
import { ConflictError, InvalidValueError, NotFoundError } from '../errors.ts';
import { Projects } from '../projects/projects.ts';
import type { Project, ProjectInput } from '../projects/projects.ts';
import { createPingpongServer } from '../server.ts';

export interface CliIo {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
    env: Record<string, string | undefined>;
    /** Resolves when the process is asked to stop (SIGTERM, SIGINT). Only `serve` waits for it. */
    waitForStop: () => Promise<void>;
}

/** Exit codes from sysexits.h. */
export const EXIT = { ok: 0, failure: 1, usage: 64, unavailable: 69, config: 78 } as const;

class CliExit extends Error {
    readonly code: number;

    constructor(code: number, message: string) {
        super(message);
        this.code = code;
    }
}

type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

interface Context {
    io: CliIo;
    config: Config;
    values: Values;
    positionals: string[];
}

interface Command {
    usage: string;
    description: string;
    options?: ParseArgsOptionsConfig;
    positionals?: number;
    run(context: Context): Promise<number>;
}

const LIMIT_OPTIONS = {
    'max-connections': 'maxConnections',
    'max-messages-per-second': 'maxMessagesPerSecond',
    'max-message-size': 'maxMessageSize',
    'max-channels-per-socket': 'maxChannelsPerSocket',
} as const satisfies Record<string, keyof Limits>;

const PROJECT_OPTIONS: ParseArgsOptionsConfig = {
    name: { type: 'string' },
    origin: { type: 'string', multiple: true },
    ...Object.fromEntries(Object.keys(LIMIT_OPTIONS).map((name) => [name, { type: 'string' }])),
};

async function withDatabase<T>(
    config: Config,
    run: (database: Database) => Promise<T>,
): Promise<T> {
    const database = createDatabase(config.databaseUrl);
    try {
        return await run(database);
    } finally {
        await database.close();
    }
}

async function withProjects<T>(
    config: Config,
    run: (projects: Projects) => Promise<T>,
): Promise<T> {
    const secretKey = requireSecretKey(config);
    return withDatabase(config, async (database) => {
        const pending = await pendingMigrations(database);
        if (pending.length > 0) {
            throw new CliExit(
                EXIT.unavailable,
                'The database has pending migrations: run `pingpong migrate` first.',
            );
        }
        return run(new Projects(database, secretKey, config.defaultLimits));
    });
}

/** Reads the project options: `--max-connections default` goes back to the server's default. */
function projectInput(values: Values): ProjectInput {
    const input: ProjectInput = {};
    if (typeof values['name'] === 'string') {
        input.name = values['name'];
    }
    if (Array.isArray(values['origin'])) {
        input.origins = values['origin'].map(String);
    }
    for (const [option, limit] of Object.entries(LIMIT_OPTIONS)) {
        const value = values[option];
        if (typeof value === 'string') {
            const number = Number(value);
            if (value !== 'default' && (!Number.isInteger(number) || number < 1)) {
                throw new CliExit(
                    EXIT.usage,
                    `--${option} must be a positive integer, or "default".`,
                );
            }
            input.limits = { ...input.limits, [limit]: value === 'default' ? null : number };
        }
    }
    return input;
}

function describeProject(project: Project): string {
    const limits = Object.entries(LIMIT_OPTIONS).map(([option, name]) => {
        const own = project.ownLimits[name] !== undefined;
        return `  ${option}: ${project.limits[name]}${own ? '' : ' (default)'}`;
    });
    return [
        `id:       ${project.id}`,
        `name:     ${project.name}`,
        `key:      ${project.key}`,
        `status:   ${project.disabled ? 'disabled' : 'enabled'}`,
        `origins:  ${project.origins.length === 0 ? '(any, on the key alone)' : project.origins.join(', ')}`,
        ...(project.previousSecretExpiresAt === undefined
            ? []
            : [`previous secret valid until ${project.previousSecretExpiresAt.toISOString()}`]),
        'limits:',
        ...limits,
    ].join('\n');
}

function toJson(project: Project): Record<string, unknown> {
    const { secrets: _secrets, ...rest } = project;
    return rest;
}

const CHECK_LABELS: Record<string, string> = {
    database: 'database',
    migrations: 'migrations',
    secretKey: 'secret key',
    redis: 'Redis',
};

const COMMANDS: Record<string, Command> = {
    serve: {
        usage: 'serve',
        description: 'Serve the HTTP API and Socket.IO until SIGTERM or SIGINT.',
        async run({ io, config }) {
            const server = await createPingpongServer(config);
            const address = await server.listen();
            io.stdout(`Pingpong is listening on ${address}\n`);
            await io.waitForStop();
            await server.close();
            return EXIT.ok;
        },
    },
    migrate: {
        usage: 'migrate',
        description: "Run the database migrations that haven't run yet.",
        async run({ io, config }) {
            const results = await withDatabase(config, migrateToLatest);
            io.stdout(
                results.length === 0
                    ? 'The database is up to date.\n'
                    : results.map((result) => `Ran ${result.migrationName}\n`).join(''),
            );
            return EXIT.ok;
        },
    },
    'projects list': {
        usage: 'projects list [--json]',
        description: 'List the projects.',
        options: { json: { type: 'boolean' } },
        async run({ io, config, values }) {
            const projects = await withProjects(config, (repository) => repository.list());
            if (values['json'] === true) {
                io.stdout(`${JSON.stringify(projects.map(toJson), null, 2)}\n`);
                return EXIT.ok;
            }
            if (projects.length === 0) {
                io.stdout('No projects yet: pingpong projects create <id>\n');
            }
            for (const project of projects) {
                io.stdout(
                    `${project.id}\t${project.key}\t${project.disabled ? 'disabled' : 'enabled'}\t${project.name}\n`,
                );
            }
            return EXIT.ok;
        },
    },
    'projects show': {
        usage: 'projects show <id> [--json]',
        description: 'Show a project, without its secret.',
        options: { json: { type: 'boolean' } },
        positionals: 1,
        async run({ io, config, values, positionals: [id = ''] }) {
            const project = await withProjects(config, (projects) => projects.get(id));
            io.stdout(
                values['json'] === true
                    ? `${JSON.stringify(toJson(project), null, 2)}\n`
                    : `${describeProject(project)}\n`,
            );
            return EXIT.ok;
        },
    },
    'projects create': {
        usage: 'projects create <id> [--name <name>] [--origin <origin>]… [--max-… <n>]',
        description:
            'Create a project, and show its key and its secret. The secret is only shown here.',
        options: PROJECT_OPTIONS,
        positionals: 1,
        async run({ io, config, values, positionals: [id = ''] }) {
            const { project, secret } = await withProjects(config, (projects) =>
                projects.create(id, projectInput(values)),
            );
            io.stdout(
                `${describeProject(project)}\nsecret:   ${secret}\n\nKeep the secret in the application's environment: it isn't shown again.\n`,
            );
            return EXIT.ok;
        },
    },
    'projects update': {
        usage: 'projects update <id> [--name <name>] [--origin <origin>]… [--no-origins] [--max-… <n|default>] [--disable|--enable]',
        description:
            'Change a project. --origin replaces the origins; --no-origins removes them all.',
        options: {
            ...PROJECT_OPTIONS,
            'no-origins': { type: 'boolean' },
            disable: { type: 'boolean' },
            enable: { type: 'boolean' },
        },
        positionals: 1,
        async run({ io, config, values, positionals: [id = ''] }) {
            const input = projectInput(values);
            if (values['no-origins'] === true) {
                input.origins = [];
            }
            if (values['disable'] === true && values['enable'] === true) {
                throw new CliExit(EXIT.usage, 'Choose --disable or --enable, not both.');
            }
            if (values['disable'] === true || values['enable'] === true) {
                input.disabled = values['disable'] === true;
            }
            const project = await withProjects(config, (projects) => projects.update(id, input));
            io.stdout(`${describeProject(project)}\n`);
            return EXIT.ok;
        },
    },
    'projects rotate-secret': {
        usage: 'projects rotate-secret <id> [--grace-period <seconds>]',
        description:
            'Give a project a new secret. The previous one stays valid for the grace period (PINGPONG_SECRET_GRACE_PERIOD, 24 hours by default).',
        options: { 'grace-period': { type: 'string' } },
        positionals: 1,
        async run({ io, config, values, positionals: [id = ''] }) {
            const value = values['grace-period'];
            const gracePeriod =
                typeof value === 'string' ? Number(value) : config.secretGracePeriod;
            if (!Number.isInteger(gracePeriod) || gracePeriod < 0) {
                throw new CliExit(EXIT.usage, '--grace-period must be a number of seconds.');
            }
            const { project, secret } = await withProjects(config, (projects) =>
                projects.rotateSecret(id, gracePeriod),
            );
            io.stdout(
                `secret:   ${secret}\n` +
                    (project.previousSecretExpiresAt === undefined
                        ? 'The previous secret no longer works.\n'
                        : `The previous secret works until ${project.previousSecretExpiresAt.toISOString()}.\n`),
            );
            return EXIT.ok;
        },
    },
    'projects delete': {
        usage: 'projects delete <id> --yes',
        description: 'Delete a project. Its clients are refused from then on.',
        options: { yes: { type: 'boolean' } },
        positionals: 1,
        async run({ io, config, values, positionals: [id = ''] }) {
            if (values['yes'] !== true) {
                throw new CliExit(
                    EXIT.usage,
                    `This deletes the project "${id}": add --yes to confirm.`,
                );
            }
            await withProjects(config, (projects) => projects.delete(id));
            io.stdout(`Deleted ${id}.\n`);
            return EXIT.ok;
        },
    },
    doctor: {
        usage: 'doctor',
        description:
            'Check the configuration, the database, the migrations, the secret key and Redis.',
        async run({ io, config }) {
            const checks = await withDatabase(config, async (database) => {
                if (config.redisUrl === undefined) {
                    return runChecks({ database, secretKey: config.secretKey });
                }
                const redis = createClient({ url: config.redisUrl });
                // Without it, a Redis that doesn't answer is an unhandled error event.
                redis.on('error', () => undefined);
                try {
                    return await runChecks({
                        database,
                        secretKey: config.secretKey,
                        pingRedis: async () => {
                            await redis.connect();
                            await redis.ping();
                        },
                    });
                } finally {
                    redis.destroy();
                }
            });
            for (const check of checks) {
                const label = CHECK_LABELS[check.name] ?? check.name;
                io.stdout(
                    check.status === 'ok'
                        ? `ok    ${label}${check.detail === undefined ? '' : ` (${check.detail})`}\n`
                        : `${check.status === 'failed' ? 'FAIL' : '-   '}  ${label}${check.detail === undefined ? '' : `: ${check.detail}`}\n`,
                );
            }
            const healthy = checks.every((check) => check.status !== 'failed');
            return healthy ? EXIT.ok : EXIT.failure;
        },
    },
};

function help(): string {
    const lines = Object.values(COMMANDS).map(
        (command) => `  pingpong ${command.usage}\n      ${command.description}`,
    );
    return `Usage:\n${lines.join('\n')}\n\nConfiguration comes from PINGPONG_* environment variables (see docs/running.md).\n`;
}

/** Runs the `pingpong` command line. Returns the exit code. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
    const name = argv[0] === 'projects' ? `projects ${argv[1] ?? ''}` : (argv[0] ?? '');
    const command = COMMANDS[name];
    if (command === undefined || argv.includes('--help')) {
        (command === undefined && argv.length > 0 && !argv.includes('--help')
            ? io.stderr
            : io.stdout)(help());
        return command === undefined && argv.length > 0 && !argv.includes('--help')
            ? EXIT.usage
            : EXIT.ok;
    }
    try {
        const { values, positionals } = parseArgs({
            args: argv.slice(name.split(' ').length),
            options: command.options ?? {},
            allowPositionals: true,
            strict: true,
        });
        if (positionals.length !== (command.positionals ?? 0)) {
            throw new CliExit(EXIT.usage, `Usage: pingpong ${command.usage}`);
        }
        const config = loadConfig(io.env);
        return await command.run({ io, config, values, positionals });
    } catch (error) {
        if (error instanceof CliExit) {
            io.stderr(`${error.message}\n`);
            return error.code;
        }
        if (error instanceof ConfigError) {
            io.stderr(`${error.message}\n`);
            return EXIT.config;
        }
        if (
            error instanceof NotFoundError ||
            error instanceof ConflictError ||
            error instanceof InvalidValueError
        ) {
            io.stderr(`${error.message}\n`);
            return EXIT.failure;
        }
        if (
            error instanceof TypeError &&
            'code' in error &&
            String(error.code).startsWith('ERR_PARSE_ARGS')
        ) {
            io.stderr(`${error.message}\nUsage: pingpong ${command.usage}\n`);
            return EXIT.usage;
        }
        throw error;
    }
}

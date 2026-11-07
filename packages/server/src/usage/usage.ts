import { sql } from 'kysely';

import type { UsageLine, UsageReport } from '@pingpong-io/protocol';

import type { Database } from '../database/connection.ts';
import type { Realtime } from '../realtime/realtime.ts';

const DAY = 86_400_000;

/** The most days a report covers, as the admin API allows (decision 0010). */
export const MAX_USAGE_DAYS = 400;

/** The UTC day of a date: `2026-11-07`. */
export function utcDay(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** What a project used since the last flush. */
interface Counts {
    messages: number;
    bytes: number;
    connectionMinutes: number;
    peakConnections: number;
    connectionsRefused: number;
    rateLimited: number;
}

const ZERO: Counts = {
    messages: 0,
    bytes: 0,
    connectionMinutes: 0,
    peakConnections: 0,
    connectionsRefused: 0,
    rateLimited: 0,
};

function isEmpty(counts: Counts): boolean {
    return Object.values(counts).every((value) => value === 0);
}

/** Sums are added, the peak keeps the highest: how two flushes of a day combine. */
function combine(a: Counts, b: Counts): Counts {
    return {
        messages: a.messages + b.messages,
        bytes: a.bytes + b.bytes,
        connectionMinutes: a.connectionMinutes + b.connectionMinutes,
        peakConnections: Math.max(a.peakConnections, b.peakConnections),
        connectionsRefused: a.connectionsRefused + b.connectionsRefused,
        rateLimited: a.rateLimited + b.rateLimited,
    };
}

/** What a cumulative counter grew by. A counter that went back (a project created again) restarts. */
function growth(current: number, previous: number): number {
    return current >= previous ? current - previous : current;
}

export interface UsageRecorderOptions {
    /** How often the counts go to the database, in milliseconds. */
    flushInterval: number;
    /** How many UTC days of usage are kept, today included. */
    retentionDays: number;
    now?: () => Date;
    /** Where a failed flush or purge is reported. Its counts are kept for the next flush. */
    onError?: (error: unknown) => void;
}

/**
 * Usage per project and UTC day (decision 0010). Every `flushInterval`, adds what this server
 * counted since the last flush to the row of the day, with an upsert, so several servers add to
 * the same rows. Once a day, deletes the rows older than the retention.
 */
export class UsageRecorder {
    readonly #database: Database;
    readonly #realtime: Realtime;
    readonly #options: Required<Omit<UsageRecorderOptions, 'onError'>> &
        Pick<UsageRecorderOptions, 'onError'>;
    /** The cumulative counters at the last flush, by project. */
    readonly #seen = new Map<string, Omit<Counts, 'connectionMinutes' | 'peakConnections'>>();
    /** Connection minutes not written yet: only whole minutes are. */
    readonly #minutes = new Map<string, number>();
    /** Counts of a flush that failed, by day and project, for the next one. */
    readonly #unwritten = new Map<string, Counts>();
    #sampledAt: number;
    #flushing: Promise<void> = Promise.resolve();
    #timers: NodeJS.Timeout[] = [];

    constructor(database: Database, realtime: Realtime, options: UsageRecorderOptions) {
        this.#database = database;
        this.#realtime = realtime;
        this.#options = { now: () => new Date(), ...options };
        this.#sampledAt = this.#options.now().getTime();
    }

    /** Flushes every `flushInterval`, and purges now and once a day. */
    start(): void {
        const report = (error: unknown) => this.#options.onError?.(error);
        const flush = setInterval(
            () => void this.flush().catch(report),
            this.#options.flushInterval,
        );
        const purge = setInterval(() => void this.purge().catch(report), DAY);
        flush.unref();
        purge.unref();
        this.#timers = [flush, purge];
        void this.purge().catch(report);
    }

    /** What every project used since the last flush, by project. */
    #collect(now: number): Map<string, Counts> {
        const stats = this.#realtime.stats;
        const elapsed = Math.max(0, now - this.#sampledAt) / 60_000;
        this.#sampledAt = now;
        const collected = new Map<string, Counts>();
        const ids = new Set([...stats.projectIds(), ...this.#realtime.projectIds()]);
        for (const id of ids) {
            const counters = stats.peek(id);
            const connections = this.#realtime.connections(id);
            const minutes = (this.#minutes.get(id) ?? 0) + connections * elapsed;
            const wholeMinutes = Math.floor(minutes);
            if (minutes - wholeMinutes > 0) {
                this.#minutes.set(id, minutes - wholeMinutes);
            } else {
                this.#minutes.delete(id);
            }
            const seen = this.#seen.get(id) ?? {
                messages: 0,
                bytes: 0,
                connectionsRefused: 0,
                rateLimited: 0,
            };
            const refused = Object.values(counters?.connectionsRefused ?? {}).reduce(
                (total, count) => total + count,
                0,
            );
            const current = {
                messages: counters?.messages ?? 0,
                bytes: counters?.bytes ?? 0,
                connectionsRefused: refused,
                rateLimited: counters?.rateLimited ?? 0,
            };
            if (counters === undefined) {
                this.#seen.delete(id);
            } else {
                this.#seen.set(id, current);
            }
            const counts: Counts = {
                messages: growth(current.messages, seen.messages),
                bytes: growth(current.bytes, seen.bytes),
                connectionMinutes: wholeMinutes,
                peakConnections: Math.max(stats.takePeak(id), connections),
                connectionsRefused: growth(current.connectionsRefused, seen.connectionsRefused),
                rateLimited: growth(current.rateLimited, seen.rateLimited),
            };
            if (!isEmpty(counts)) {
                collected.set(id, counts);
            }
        }
        return collected;
    }

    /** Adds what was counted since the last flush to the rows of the day. */
    flush(): Promise<void> {
        // One flush at a time: a slow database doesn't make two flushes count the same minute.
        // A failed flush keeps its counts for the next one, which still runs.
        this.#flushing = this.#flushing.catch(() => undefined).then(() => this.#flush());
        return this.#flushing;
    }

    async #flush(): Promise<void> {
        const now = this.#options.now();
        const day = utcDay(now);
        for (const [id, counts] of this.#collect(now.getTime())) {
            const key = `${day}\n${id}`;
            this.#unwritten.set(key, combine(this.#unwritten.get(key) ?? ZERO, counts));
        }
        for (const [key, counts] of [...this.#unwritten]) {
            const [rowDay = day, projectId = ''] = key.split('\n');
            await this.#database.kysely
                .insertInto('usage')
                .values({
                    project_id: projectId,
                    day: rowDay,
                    messages: counts.messages,
                    bytes: counts.bytes,
                    connection_minutes: counts.connectionMinutes,
                    peak_connections: counts.peakConnections,
                    connections_refused: counts.connectionsRefused,
                    rate_limited: counts.rateLimited,
                })
                .onConflict((conflict) =>
                    conflict.columns(['project_id', 'day']).doUpdateSet({
                        messages: sql`usage.messages + excluded.messages`,
                        bytes: sql`usage.bytes + excluded.bytes`,
                        connection_minutes: sql`usage.connection_minutes + excluded.connection_minutes`,
                        peak_connections: sql`case when excluded.peak_connections > usage.peak_connections then excluded.peak_connections else usage.peak_connections end`,
                        connections_refused: sql`usage.connections_refused + excluded.connections_refused`,
                        rate_limited: sql`usage.rate_limited + excluded.rate_limited`,
                    }),
                )
                .execute();
            this.#unwritten.delete(key);
        }
    }

    /** Deletes the rows older than the retention. */
    async purge(): Promise<void> {
        const oldest = utcDay(
            new Date(this.#options.now().getTime() - (this.#options.retentionDays - 1) * DAY),
        );
        await this.#database.kysely.deleteFrom('usage').where('day', '<', oldest).execute();
    }

    /** Stops the timers, and flushes what was counted since the last flush. */
    async close(): Promise<void> {
        this.#timers.forEach((timer) => clearInterval(timer));
        this.#timers = [];
        await this.flush();
    }
}

export interface UsageQuery {
    /** UTC days, today included: 1 to 400. */
    days: number;
    projectId?: string | undefined;
    now?: Date;
}

/** The usage per project and UTC day over the last `days` days, by day then project. */
export async function usageReport(
    database: Database,
    { days, projectId, now = new Date() }: UsageQuery,
): Promise<UsageReport> {
    const since = utcDay(new Date(now.getTime() - (days - 1) * DAY));
    let query = database.kysely
        .selectFrom('usage')
        .selectAll()
        .where('day', '>=', since)
        .orderBy('day')
        .orderBy('project_id');
    if (projectId !== undefined) {
        query = query.where('project_id', '=', projectId);
    }
    const rows = await query.execute();
    const lines: UsageLine[] = rows.map((row) => ({
        project: row.project_id,
        day: row.day,
        messages: Number(row.messages),
        bytes: Number(row.bytes),
        connectionMinutes: Number(row.connection_minutes),
        peakConnections: Number(row.peak_connections),
        connectionsRefused: Number(row.connections_refused),
        rateLimited: Number(row.rate_limited),
    }));
    return { since, until: utcDay(now), lines };
}

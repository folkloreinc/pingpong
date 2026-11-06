import { Kysely, PostgresDialect, SqliteDialect, sql } from 'kysely';
import type { Dialect as KyselyDialect } from 'kysely';
import pg from 'pg';

import { openSqlite } from './sqlite.ts';
import type { Tables } from './tables.ts';

/** The databases Pingpong supports (decision 0008). */
export type Dialect = 'postgres' | 'sqlite';

export interface Database {
    kysely: Kysely<Tables>;
    dialect: Dialect;
    /** Runs a trivial query: resolves when the database answers. */
    ping(): Promise<void>;
    close(): Promise<void>;
}

function parseUrl(databaseUrl: string): URL {
    try {
        return new URL(databaseUrl);
    } catch {
        // The URL can hold a password: never put it in the message.
        throw new Error('The database URL is not a valid URL.');
    }
}

/** The dialect of a database URL: `postgres://…` or `sqlite:…`. */
export function getDialect(databaseUrl: string): Dialect {
    const { protocol } = parseUrl(databaseUrl);
    if (protocol === 'postgres:' || protocol === 'postgresql:') {
        return 'postgres';
    }
    if (protocol === 'sqlite:') {
        return 'sqlite';
    }
    throw new Error(`The database URL must start with postgres:// or sqlite:, not ${protocol}.`);
}

/**
 * The file of a SQLite database URL: `sqlite:///var/lib/pingpong/pingpong.db` (absolute),
 * `sqlite:data/pingpong.db` (relative to the working directory) or `sqlite::memory:`.
 */
export function getSqlitePath(databaseUrl: string): string {
    const url = parseUrl(databaseUrl);
    if (url.host !== '' || url.username !== '' || url.password !== '') {
        throw new Error(
            'A SQLite database URL has no host: use sqlite:///absolute/path.db or sqlite:relative/path.db.',
        );
    }
    const path = decodeURIComponent(url.pathname);
    if (path === '' || path === '/') {
        throw new Error('The SQLite database URL has no file path.');
    }
    return path;
}

function createKyselyDialect(databaseUrl: string, poolSize: number): KyselyDialect {
    return getDialect(databaseUrl) === 'postgres'
        ? new PostgresDialect({
              pool: new pg.Pool({ connectionString: databaseUrl, max: poolSize }),
          })
        : new SqliteDialect({ database: openSqlite(getSqlitePath(databaseUrl)) });
}

/** Connects to a database. The connection is lazy: nothing happens until a query. */
export function createDatabase(databaseUrl: string, { poolSize = 5 } = {}): Database {
    const kysely = new Kysely<Tables>({ dialect: createKyselyDialect(databaseUrl, poolSize) });
    return {
        kysely,
        dialect: getDialect(databaseUrl),
        async ping() {
            await sql`select 1`.execute(kysely);
        },
        close: () => kysely.destroy(),
    };
}

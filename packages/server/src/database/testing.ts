import { createDatabase } from './connection.ts';
import type { Database } from './connection.ts';
import { MIGRATION_LOCK_TABLE, MIGRATION_TABLE, migrateToLatest } from './migrate.ts';

const TABLES_TO_DROP = ['projects', MIGRATION_TABLE, MIGRATION_LOCK_TABLE];

/**
 * The database tests run on: `PINGPONG_TEST_DATABASE_URL` when it's set (CI runs PostgreSQL),
 * otherwise SQLite in memory.
 */
export function testDatabaseUrl(): string {
    return process.env['PINGPONG_TEST_DATABASE_URL'] || 'sqlite::memory:';
}

/** Empties a database: drops Pingpong's tables. Only for tests. */
export async function dropTables(database: Database): Promise<void> {
    for (const table of TABLES_TO_DROP) {
        await database.kysely.schema.dropTable(table).ifExists().execute();
    }
}

/**
 * Connects to the test database, empties it and runs the migrations. The server's test files run
 * one after the other (see vitest.config.ts), since they share the database.
 */
export async function createTestDatabase(url = testDatabaseUrl()): Promise<Database> {
    const database = createDatabase(url, { poolSize: 2 });
    await dropTables(database);
    await migrateToLatest(database);
    return database;
}

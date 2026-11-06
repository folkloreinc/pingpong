import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

import type { Dialect } from '../connection.ts';

export function projects(dialect: Dialect): Migration {
    // ISO 8601 text with milliseconds on SQLite, which sorts and compares as text.
    const timestamp = dialect === 'postgres' ? sql`timestamptz(3)` : sql`text`;
    return {
        async up(db: Kysely<unknown>) {
            await db.schema
                .createTable('projects')
                .addColumn('id', 'varchar(63)', (column) => column.primaryKey())
                .addColumn('name', 'varchar(255)', (column) => column.notNull())
                .addColumn('key', 'varchar(80)', (column) => column.notNull().unique())
                .addColumn('secret', 'text', (column) => column.notNull())
                .addColumn('previous_secret', 'text')
                .addColumn('previous_secret_expires_at', timestamp)
                .addColumn('origins', 'text', (column) => column.notNull())
                .addColumn('max_connections', 'integer')
                .addColumn('max_messages_per_second', 'integer')
                .addColumn('max_message_size', 'integer')
                .addColumn('max_channels_per_socket', 'integer')
                .addColumn('created_at', timestamp, (column) => column.notNull())
                .addColumn('updated_at', timestamp, (column) => column.notNull())
                .addColumn('disabled_at', timestamp)
                .execute();
        },
    };
}

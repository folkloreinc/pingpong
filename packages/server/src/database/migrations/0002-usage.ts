import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * Usage per project and UTC day (decision 0010). No foreign key to `projects`: a project's usage
 * outlives it, for the cost splits of past months.
 */
export function usage(): Migration {
    return {
        async up(db: Kysely<unknown>) {
            await db.schema
                .createTable('usage')
                .addColumn('project_id', 'varchar(63)', (column) => column.notNull())
                // `YYYY-MM-DD`: sorts and compares as text on every database.
                .addColumn('day', 'varchar(10)', (column) => column.notNull())
                .addColumn('messages', 'bigint', (column) => column.notNull().defaultTo(0))
                .addColumn('bytes', 'bigint', (column) => column.notNull().defaultTo(0))
                .addColumn('connection_minutes', 'bigint', (column) =>
                    column.notNull().defaultTo(0),
                )
                .addColumn('peak_connections', 'integer', (column) => column.notNull().defaultTo(0))
                .addColumn('connections_refused', 'bigint', (column) =>
                    column.notNull().defaultTo(0),
                )
                .addColumn('rate_limited', 'bigint', (column) => column.notNull().defaultTo(0))
                .addPrimaryKeyConstraint('usage_pk', ['project_id', 'day'])
                .execute();
            await db.schema.createIndex('usage_day_index').on('usage').column('day').execute();
        },
    };
}

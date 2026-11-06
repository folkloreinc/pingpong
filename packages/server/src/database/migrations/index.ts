import type { Migration } from 'kysely/migration';

import type { Dialect } from '../connection.ts';
import { projects } from './0001-projects.ts';

/**
 * Every migration, in order. A migration is never changed once released: changes to the schema
 * are new migrations, additive within a major version.
 */
export function migrations(dialect: Dialect): Record<string, Migration> {
    return {
        '0001-projects': projects(dialect),
    };
}

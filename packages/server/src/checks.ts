import type { ServerCheck } from '@pingpong-io/protocol';

import { decryptSecret } from './crypto.ts';
import type { Database } from './database/connection.ts';
import { pendingMigrations } from './database/migrate.ts';

export interface CheckTargets {
    database: Database;
    secretKey: Buffer | undefined;
    /** Pings Redis. Undefined when Redis isn't configured. */
    pingRedis?: (() => Promise<unknown>) | undefined;
}

/**
 * The checks of `pingpong doctor` and of the admin API's status: the database, its migrations,
 * that the secret key decrypts every project's secret, and Redis.
 */
export async function runChecks({
    database,
    secretKey,
    pingRedis,
}: CheckTargets): Promise<ServerCheck[]> {
    const checks: ServerCheck[] = [];
    try {
        await database.ping();
        checks.push({ name: 'database', status: 'ok', detail: database.dialect });
    } catch {
        checks.push(
            { name: 'database', status: 'failed', detail: "it doesn't answer" },
            { name: 'migrations', status: 'skipped', detail: "the database doesn't answer" },
            { name: 'secretKey', status: 'skipped', detail: "the database doesn't answer" },
        );
    }
    if (checks.length === 1) {
        const pending = await pendingMigrations(database);
        checks.push(
            pending.length === 0
                ? { name: 'migrations', status: 'ok' }
                : {
                      name: 'migrations',
                      status: 'failed',
                      detail: `${pending.length} pending, run pingpong migrate`,
                  },
        );
        if (secretKey === undefined) {
            checks.push({
                name: 'secretKey',
                status: 'failed',
                detail: 'PINGPONG_SECRET_KEY is not set',
            });
        } else if (pending.length > 0) {
            checks.push({ name: 'secretKey', status: 'skipped', detail: 'migrations pending' });
        } else {
            const rows = await database.kysely
                .selectFrom('projects')
                .select(['id', 'secret'])
                .execute();
            const unreadable = rows.filter((row) => {
                try {
                    decryptSecret(secretKey, row.secret);
                    return false;
                } catch {
                    return true;
                }
            });
            checks.push(
                unreadable.length === 0
                    ? { name: 'secretKey', status: 'ok', detail: `${rows.length} project(s)` }
                    : {
                          name: 'secretKey',
                          status: 'failed',
                          detail: `it can't decrypt the secrets of ${unreadable.map((row) => row.id).join(', ')}`,
                      },
            );
        }
    }
    if (pingRedis === undefined) {
        checks.push({
            name: 'redis',
            status: 'skipped',
            detail: 'not configured, one server only',
        });
    } else {
        try {
            await pingRedis();
            checks.push({ name: 'redis', status: 'ok' });
        } catch {
            checks.push({ name: 'redis', status: 'failed', detail: "it doesn't answer" });
        }
    }
    return checks;
}

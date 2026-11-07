import { createAdapter } from '@socket.io/redis-streams-adapter';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { createClient } from 'redis';

import { ConfigError, requireSecretKey } from './config.ts';
import type { Config } from './config.ts';
import { createDatabase } from './database/connection.ts';
import type { Database } from './database/connection.ts';
import { pendingMigrations } from './database/migrate.ts';
import { adminRoutes } from './http/admin.ts';
import { dashboardRoutes, findDashboard } from './http/dashboard.ts';
import type { StaticFile } from './http/dashboard.ts';
import { registerRoutes } from './http/routes.ts';
import { Metrics, createMetricsServer } from './metrics.ts';
import { ProjectCache } from './projects/cache.ts';
import { Projects } from './projects/projects.ts';
import { Realtime } from './realtime/realtime.ts';
import { UsageRecorder } from './usage/usage.ts';

export interface PingpongServer {
    app: FastifyInstance;
    realtime: Realtime;
    /** Usage per project and day, flushed to the database (decision 0010). */
    usage: UsageRecorder;
    /** The address of `/metrics` once listening, when `PINGPONG_METRICS_PORT` is set. */
    metricsAddress: string | undefined;
    projects: Projects;
    cache: ProjectCache;
    database: Database;
    /** Starts listening. Resolves with the address, such as `http://127.0.0.1:3000`. */
    listen(): Promise<string>;
    /** Disconnects every socket, stops listening and closes the connections it opened. */
    close(): Promise<void>;
}

export interface ServerOptions {
    /** A database to use instead of opening `config.databaseUrl`. It is not closed with the server. */
    database?: Database;
    /** Fastify's logger: false to disable it. */
    logger?: boolean;
    /**
     * The built dashboard to serve at `/dashboard/`, instead of the files of the installed
     * `@pingpong-io/dashboard`. Only with an admin token and `PINGPONG_DASHBOARD` (decision 0009).
     */
    dashboard?: Map<string, StaticFile>;
}

/**
 * Creates the server: the HTTP API and Socket.IO on one HTTP server, with the Redis Streams
 * adapter when Redis is configured. Refuses to start while migrations are pending.
 */
export async function createPingpongServer(
    config: Config,
    options: ServerOptions = {},
): Promise<PingpongServer> {
    const secretKey = requireSecretKey(config);
    const ownsDatabase = options.database === undefined;
    const database = options.database ?? createDatabase(config.databaseUrl);
    const pending = await pendingMigrations(database);
    if (pending.length > 0) {
        if (ownsDatabase) {
            await database.close();
        }
        throw new ConfigError(
            `The database has ${pending.length} pending migration(s): run \`pingpong migrate\` first.`,
        );
    }

    const redis =
        config.redisUrl === undefined ? undefined : createClient({ url: config.redisUrl });
    await redis?.connect();

    const projects = new Projects(database, secretKey, config.defaultLimits);
    const cache = new ProjectCache(projects, config.projectCacheTtl);
    const app = Fastify({
        logger: options.logger === false ? false : { level: config.logLevel },
        trustProxy: config.trustProxy,
        // A batch of 100 messages at the default limit of 10 KB, with room for the JSON around them.
        bodyLimit: 2 * 1024 * 1024,
    });
    const realtime = new Realtime(app.server, cache, {
        pingInterval: config.pingInterval,
        pingTimeout: config.pingTimeout,
        recoveryWindow: config.recoveryWindow,
        countInterval: config.countInterval,
        ...(redis === undefined ? {} : { adapter: createAdapter(redis) }),
    });
    const usage = new UsageRecorder(database, realtime, {
        flushInterval: config.usageFlushInterval,
        retentionDays: config.usageRetention,
        onError: (error) => app.log.error({ err: error }, "Usage couldn't be written"),
    });
    const metricsServer =
        config.metricsPort === undefined
            ? undefined
            : createMetricsServer(new Metrics(database, realtime));
    registerRoutes(app, {
        projects,
        cache,
        realtime,
        async checkHealth() {
            await database.ping();
            await redis?.ping();
        },
    });
    if (config.adminToken !== undefined) {
        void app.register(adminRoutes, {
            prefix: '/admin/v1',
            adminToken: config.adminToken,
            projects,
            cache,
            realtime,
            database,
            checks: {
                database,
                secretKey,
                pingRedis: redis === undefined ? undefined : () => redis.ping(),
            },
            secretGracePeriod: config.secretGracePeriod,
        });
        // The dashboard is useless without the admin API, and the admin token is its sign-in.
        if (config.dashboard) {
            const found =
                options.dashboard === undefined
                    ? await findDashboard()
                    : { files: options.dashboard };
            if (found.files !== undefined) {
                void app.register(dashboardRoutes, { files: found.files });
            } else {
                app.log.warn({ err: found.error }, "The dashboard can't be served");
            }
        }
    }

    const server: PingpongServer = {
        app,
        realtime,
        usage,
        metricsAddress: undefined,
        projects,
        cache,
        database,
        async listen() {
            const address = await app.listen({ host: config.host, port: config.port });
            usage.start();
            if (metricsServer !== undefined && config.metricsPort !== undefined) {
                server.metricsAddress = await metricsServer.listen(
                    config.metricsHost,
                    config.metricsPort,
                );
            }
            return address;
        },
        async close() {
            await metricsServer?.close();
            // While the sockets are still connected: their last minutes count.
            await usage
                .close()
                .catch((error: unknown) =>
                    app.log.error({ err: error }, "Usage couldn't be written"),
                );
            // Socket.IO first: it disconnects the sockets, which would keep the HTTP server open.
            await realtime.close();
            await app.close();
            await redis?.quit();
            if (ownsDatabase) {
                await database.close();
            }
        },
    };
    return server;
}

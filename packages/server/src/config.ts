/** The server's configuration, from environment variables (see `docs/running.md`). */
export interface Config {
    /** `postgres://…` or `sqlite:…` (decision 0008). */
    databaseUrl: string;
    /** With Redis, Socket.IO uses the Redis Streams adapter, so several servers share sessions. */
    redisUrl: string | undefined;
    /** 32 bytes that encrypt project secrets at rest. Required to create projects or serve. */
    secretKey: Buffer | undefined;
    host: string;
    port: number;
    /** Milliseconds between Socket.IO pings, and before a missing pong closes the connection. */
    pingInterval: number;
    pingTimeout: number;
    /** How long a disconnected socket can be recovered, in milliseconds (decision 0006). */
    recoveryWindow: number;
    /** How often subscription counts are sent, at most, per channel, in milliseconds. */
    countInterval: number;
    /** How long the previous secret stays valid after a rotation, in seconds. */
    secretGracePeriod: number;
    /** How long projects are cached before they are read again, in milliseconds. */
    projectCacheTtl: number;
    /** Limits of projects that don't set their own. */
    defaultLimits: Limits;
    /** `PINGPONG_ADMIN_TOKEN`: the admin API (and the dashboard) exist only with it (decision 0009). */
    adminToken: string | undefined;
    /** Serves the dashboard at `/dashboard/` with the admin API: `PINGPONG_DASHBOARD=false` turns it off. */
    dashboard: boolean;
    /** How often usage goes to the database, in milliseconds (decision 0010). */
    usageFlushInterval: number;
    /** How many UTC days of usage are kept, today included. */
    usageRetention: number;
    /** `/metrics` for Prometheus, on a listener of its own: off without a port (decision 0010). */
    metricsPort: number | undefined;
    metricsHost: string;
    /** Whether to trust `X-Forwarded-*` headers from a reverse proxy. */
    trustProxy: boolean;
    logLevel: string;
}

export interface Limits {
    maxConnections: number;
    maxMessagesPerSecond: number;
    /** Bytes of a message, serialized. */
    maxMessageSize: number;
    maxChannelsPerSocket: number;
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

function integer(env: Env, name: string, fallback: number, minimum = 0): number {
    const value = env[name];
    if (value === undefined || value === '') {
        return fallback;
    }
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum) {
        throw new ConfigError(`${name} must be an integer of at least ${minimum}.`);
    }
    return number;
}

function boolean(env: Env, name: string): boolean {
    const value = (env[name] ?? '').toLowerCase();
    if (['', '0', 'false', 'no'].includes(value)) {
        return false;
    }
    if (['1', 'true', 'yes'].includes(value)) {
        return true;
    }
    throw new ConfigError(`${name} must be true or false.`);
}

/** The shortest admin token: 32 characters, such as `openssl rand -hex 32` gives 64 of. */
export const MIN_ADMIN_TOKEN_LENGTH = 32;

/** Reads `PINGPONG_ADMIN_TOKEN`: at least 32 characters, without spaces. */
export function parseAdminToken(value: string | undefined): string | undefined {
    if (value === undefined || value === '') {
        return undefined;
    }
    if (value.length < MIN_ADMIN_TOKEN_LENGTH || /\s/.test(value)) {
        throw new ConfigError(
            `PINGPONG_ADMIN_TOKEN must be at least ${MIN_ADMIN_TOKEN_LENGTH} characters, without spaces (openssl rand -hex 32).`,
        );
    }
    return value;
}

/** Reads `PINGPONG_SECRET_KEY`: 32 bytes, as 64 hex characters or in base64. */
export function parseSecretKey(value: string | undefined): Buffer | undefined {
    if (value === undefined || value === '') {
        return undefined;
    }
    const key = /^[0-9a-fA-F]{64}$/.test(value)
        ? Buffer.from(value, 'hex')
        : Buffer.from(value, 'base64');
    if (key.length !== 32) {
        throw new ConfigError(
            'PINGPONG_SECRET_KEY must be 32 bytes, as 64 hex characters or in base64 (openssl rand -hex 32).',
        );
    }
    return key;
}

export function loadConfig(env: Env): Config {
    const databaseUrl = env['PINGPONG_DATABASE_URL'];
    if (databaseUrl === undefined || databaseUrl === '') {
        throw new ConfigError('PINGPONG_DATABASE_URL is required (postgres://… or sqlite:…).');
    }
    return {
        databaseUrl,
        redisUrl: env['PINGPONG_REDIS_URL'] || undefined,
        secretKey: parseSecretKey(env['PINGPONG_SECRET_KEY']),
        host: env['PINGPONG_HOST'] || '0.0.0.0',
        port: integer(env, 'PINGPONG_PORT', 3000),
        pingInterval: integer(env, 'PINGPONG_PING_INTERVAL', 10_000, 100),
        pingTimeout: integer(env, 'PINGPONG_PING_TIMEOUT', 5_000, 100),
        recoveryWindow: integer(env, 'PINGPONG_RECOVERY_WINDOW', 120_000),
        countInterval: integer(env, 'PINGPONG_COUNT_INTERVAL', 2_000, 100),
        secretGracePeriod: integer(env, 'PINGPONG_SECRET_GRACE_PERIOD', 86_400),
        projectCacheTtl: integer(env, 'PINGPONG_PROJECT_CACHE_TTL', 5_000),
        defaultLimits: {
            maxConnections: integer(env, 'PINGPONG_MAX_CONNECTIONS', 10_000, 1),
            maxMessagesPerSecond: integer(env, 'PINGPONG_MAX_MESSAGES_PER_SECOND', 100, 1),
            maxMessageSize: integer(env, 'PINGPONG_MAX_MESSAGE_SIZE', 10_240, 64),
            maxChannelsPerSocket: integer(env, 'PINGPONG_MAX_CHANNELS_PER_SOCKET', 100, 1),
        },
        adminToken: parseAdminToken(env['PINGPONG_ADMIN_TOKEN']),
        dashboard:
            env['PINGPONG_DASHBOARD'] === undefined ? true : boolean(env, 'PINGPONG_DASHBOARD'),
        usageFlushInterval: integer(env, 'PINGPONG_USAGE_FLUSH_INTERVAL', 60_000, 1000),
        usageRetention: integer(env, 'PINGPONG_USAGE_RETENTION', 400, 1),
        metricsPort:
            env['PINGPONG_METRICS_PORT'] === undefined || env['PINGPONG_METRICS_PORT'] === ''
                ? undefined
                : integer(env, 'PINGPONG_METRICS_PORT', 0),
        metricsHost: env['PINGPONG_METRICS_HOST'] || '127.0.0.1',
        trustProxy: boolean(env, 'PINGPONG_TRUST_PROXY'),
        logLevel: env['PINGPONG_LOG_LEVEL'] || 'info',
    };
}

/** The secret key, or a `ConfigError` that says how to make one. */
export function requireSecretKey(config: Config): Buffer {
    if (config.secretKey === undefined) {
        throw new ConfigError(
            'PINGPONG_SECRET_KEY is required: 32 random bytes that encrypt project secrets (openssl rand -hex 32).',
        );
    }
    return config.secretKey;
}

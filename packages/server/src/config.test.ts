import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig, parseSecretKey, requireSecretKey } from './config.ts';

const base = { PINGPONG_DATABASE_URL: 'sqlite::memory:' };

describe('loadConfig', () => {
    it('has defaults for everything but the database', () => {
        const config = loadConfig(base);
        expect(config).toMatchObject({
            host: '0.0.0.0',
            port: 3000,
            pingInterval: 10_000,
            pingTimeout: 5_000,
            recoveryWindow: 120_000,
            secretGracePeriod: 86_400,
            redisUrl: undefined,
            secretKey: undefined,
            defaultLimits: {
                maxConnections: 10_000,
                maxMessagesPerSecond: 100,
                maxMessageSize: 10_240,
                maxChannelsPerSocket: 100,
            },
        });
        expect(() => loadConfig({})).toThrow(ConfigError);
    });

    it('reads numbers and refuses what is not one', () => {
        expect(loadConfig({ ...base, PINGPONG_PORT: '8080' }).port).toBe(8080);
        expect(() => loadConfig({ ...base, PINGPONG_PORT: 'eighty' })).toThrow(/PINGPONG_PORT/);
        expect(() => loadConfig({ ...base, PINGPONG_MAX_MESSAGE_SIZE: '10' })).toThrow(
            /at least 64/,
        );
    });

    it('reads booleans', () => {
        expect(loadConfig({ ...base, PINGPONG_TRUST_PROXY: 'true' }).trustProxy).toBe(true);
        expect(() => loadConfig({ ...base, PINGPONG_TRUST_PROXY: 'maybe' })).toThrow(ConfigError);
    });
});

describe('the secret key', () => {
    it('is 32 bytes in hex or base64', () => {
        expect(parseSecretKey('ab'.repeat(32))).toHaveLength(32);
        expect(parseSecretKey(Buffer.alloc(32, 7).toString('base64'))).toHaveLength(32);
        expect(() => parseSecretKey('short')).toThrow(ConfigError);
    });

    it('is required to serve and to manage projects, with a hint', () => {
        expect(() => requireSecretKey(loadConfig(base))).toThrow(/openssl rand -hex 32/);
    });
});

describe('the admin token', () => {
    it('is optional: without it, there is no admin API', () => {
        expect(loadConfig(base).adminToken).toBeUndefined();
        expect(loadConfig({ ...base, PINGPONG_ADMIN_TOKEN: '' }).adminToken).toBeUndefined();
    });

    it('has at least 32 characters and no spaces', () => {
        const token = 'f'.repeat(64);
        expect(loadConfig({ ...base, PINGPONG_ADMIN_TOKEN: token }).adminToken).toBe(token);
        expect(() => loadConfig({ ...base, PINGPONG_ADMIN_TOKEN: 'f'.repeat(31) })).toThrow(
            /at least 32 characters/,
        );
        expect(() =>
            loadConfig({ ...base, PINGPONG_ADMIN_TOKEN: `${'f'.repeat(32)} ${'f'.repeat(32)}` }),
        ).toThrow(ConfigError);
    });
});

describe('usage and metrics', () => {
    it('flush every minute, keep 400 days, and serve no metrics by default', () => {
        expect(loadConfig(base)).toMatchObject({
            usageFlushInterval: 60_000,
            usageRetention: 400,
            metricsPort: undefined,
            metricsHost: '127.0.0.1',
        });
        expect(
            loadConfig({ ...base, PINGPONG_METRICS_PORT: '9464', PINGPONG_USAGE_RETENTION: '90' }),
        ).toMatchObject({ metricsPort: 9464, usageRetention: 90 });
        expect(() => loadConfig({ ...base, PINGPONG_USAGE_RETENTION: '0' })).toThrow(ConfigError);
    });
});

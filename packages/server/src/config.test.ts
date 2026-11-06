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

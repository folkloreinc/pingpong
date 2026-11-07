import type { AdminProject } from '@pingpong-io/protocol';

export const ADMIN_TOKEN = 'admin-token-for-tests-0123456789abcdef';

export function project(overrides: Partial<AdminProject> = {}): AdminProject {
    return {
        id: 'my-app',
        name: 'My app',
        key: 'pk_AbCdEfGhIjKlMnOpQrStUvWx',
        disabled: false,
        origins: ['https://example.com'],
        limits: {
            maxConnections: 500,
            maxMessagesPerSecond: 100,
            maxMessageSize: 10240,
            maxChannelsPerSocket: 100,
        },
        ownLimits: { maxConnections: 500 },
        previousSecretExpiresAt: null,
        createdAt: '2026-11-06T12:00:00.000Z',
        updatedAt: '2026-11-06T13:00:00.000Z',
        stats: {
            since: '2026-11-06T11:00:00.000Z',
            connections: 12,
            peakConnections: 40,
            connectionsRefused: { origin_not_allowed: 2 },
            channels: 3,
            messages: 1200,
            bytes: 96000,
            rateLimited: 0,
        },
        ...overrides,
    };
}

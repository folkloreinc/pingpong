import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectMessages, connectClient, connected, subscribe, waitUntil } from './client.ts';
import { startSpikeServer } from './server.ts';
import type { SpikeServer } from './server.ts';

const projects = [
    { id: 'alpha', key: 'alpha-key', secret: 'alpha-secret', origins: ['https://alpha.test'] },
    { id: 'beta', key: 'beta-key', secret: 'beta-secret', origins: ['https://beta.test'] },
];

describe('one namespace per project', () => {
    let server: SpikeServer;
    const sockets: Socket[] = [];
    const client = (...args: Parameters<typeof connectClient>) => {
        const socket = connectClient(...args);
        sockets.push(socket);
        return socket;
    };

    beforeEach(async () => {
        server = await startSpikeServer(projects);
    });

    afterEach(async () => {
        sockets.splice(0).forEach((socket) => socket.disconnect());
        await server.close();
    });

    it('accepts the project key', async () => {
        await expect(connected(client(server.url, 'alpha', 'alpha-key'))).resolves.toBeUndefined();
    });

    it('refuses a wrong key, an unknown project and the main namespace', async () => {
        const options = { reconnection: false };
        await expect(connected(client(server.url, 'alpha', 'beta-key', options))).rejects.toThrow(
            'invalid_key',
        );
        await expect(connected(client(server.url, 'gamma', 'alpha-key', options))).rejects.toThrow(
            'unknown_project',
        );
        const main = io(server.url, { auth: { key: 'alpha-key' }, forceNew: true, ...options });
        sockets.push(main);
        await expect(connected(main)).rejects.toThrow('unknown_namespace');
        const outside = io(`${server.url}/other`, { forceNew: true, ...options });
        sockets.push(outside);
        await expect(connected(outside)).rejects.toThrow('Invalid namespace');
    });

    it('checks the origin when the client sends one', async () => {
        const fromBeta = { reconnection: false, extraHeaders: { origin: 'https://beta.test' } };
        await expect(connected(client(server.url, 'alpha', 'alpha-key', fromBeta))).rejects.toThrow(
            'origin_not_allowed',
        );
        const fromAlpha = { extraHeaders: { origin: 'https://alpha.test' } };
        await expect(
            connected(client(server.url, 'alpha', 'alpha-key', fromAlpha)),
        ).resolves.toBeUndefined();
    });

    it('keeps the channels of a project to itself', async () => {
        const alpha = client(server.url, 'alpha', 'alpha-key');
        const beta = client(server.url, 'beta', 'beta-key');
        await Promise.all([connected(alpha), connected(beta)]);
        await subscribe(alpha, { channel: 'news' });
        await subscribe(beta, { channel: 'news' });
        const alphaMessages = collectMessages(alpha);
        const betaMessages = collectMessages(beta);

        server.publish('alpha', { channel: 'news', event: 'posted', data: { id: 1 } });

        await waitUntil(() => alphaMessages.length === 1);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(betaMessages).toEqual([]);
    });

    it('still checks the key of a namespace that publishing created first', async () => {
        // Publishing calls io.of('/projects/beta') before any client connected. The namespace it
        // creates must be a child of the dynamic one, with its middleware.
        server.publish('beta', { channel: 'news', event: 'posted', data: null });

        await expect(
            connected(client(server.url, 'beta', 'alpha-key', { reconnection: false })),
        ).rejects.toThrow('invalid_key');
    });
});

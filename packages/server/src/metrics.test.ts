import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startTestServer } from './testing.ts';
import type { TestProject, TestServer } from './testing.ts';

function connected(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
    });
}

describe('/metrics', () => {
    let server: TestServer;
    let app: TestProject;

    beforeEach(async () => {
        server = await startTestServer({ PINGPONG_METRICS_PORT: '0' });
        app = await server.createProject('app', { limits: { maxMessagesPerSecond: 1 } });
        await server.createProject('idle');
    });

    afterEach(async () => {
        await server.close();
    });

    const scrape = async () => {
        const response = await fetch(`${server.server.metricsAddress ?? ''}/metrics`);
        expect(response.headers.get('content-type')).toMatch(/^text\/plain/);
        return response.text();
    };

    it('counts per project, on a listener of its own', async () => {
        expect(server.server.metricsAddress).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        const socket = server.connect(app);
        await connected(socket);
        await new Promise((resolve) => socket.emit('subscribe', { channel: 'a' }, resolve));
        await connected(server.connect('app', 'pk_wrong', { reconnection: false })).catch(
            () => undefined,
        );
        await connected(server.connect('unknown', 'pk_wrong', { reconnection: false })).catch(
            () => undefined,
        );
        await server.request(app, 'POST', '/v1/messages', { channels: ['a'], event: 'e' });
        await server.request(app, 'POST', '/v1/messages', { channels: ['a'], event: 'e' });

        const text = await scrape();
        expect(text).toMatch(/^pingpong_connections\{project="app"\} 1$/m);
        expect(text).toMatch(/^pingpong_connections\{project="idle"\} 0$/m);
        expect(text).toMatch(/^pingpong_channels\{project="app"\} 1$/m);
        expect(text).toMatch(/^pingpong_messages_total\{project="app"\} 1$/m);
        expect(text).toMatch(/^pingpong_rate_limited_total\{project="app"\} 1$/m);
        expect(text).toMatch(
            /^pingpong_connections_refused_total\{project="app",reason="invalid_key"\} 1$/m,
        );
        expect(text).toMatch(/^pingpong_process_cpu_user_seconds_total /m);
        // An id anyone can try is never a label.
        expect(text).not.toContain('project="unknown"');

        // Counters keep growing between scrapes, and don't count twice.
        await new Promise((resolve) => setTimeout(resolve, 1100));
        await server.request(app, 'POST', '/v1/messages', { channels: ['a', 'b'], event: 'e' });
        expect(await scrape()).toMatch(/^pingpong_messages_total\{project="app"\} 3$/m);
    });

    it("isn't on the API's port, and is off without PINGPONG_METRICS_PORT", async () => {
        expect((await fetch(`${server.url}/metrics`)).status).toBe(404);
        expect((await fetch(`${server.server.metricsAddress ?? ''}/other`)).status).toBe(404);
        const plain = await startTestServer();
        try {
            expect(plain.server.metricsAddress).toBeUndefined();
        } finally {
            await plain.close();
        }
    });
});

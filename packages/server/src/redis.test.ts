import { describe, expect, it } from 'vitest';

import { SOCKET_EVENTS } from '@pingpong-io/protocol';
import type { SocketMessage } from '@pingpong-io/protocol';

import { startTestServer } from './testing.ts';

const redisUrl = process.env['PINGPONG_TEST_REDIS_URL'];

describe.runIf(redisUrl)('with Redis', () => {
    it('answers /health and delivers messages through the Redis Streams adapter', async () => {
        const server = await startTestServer({ PINGPONG_REDIS_URL: redisUrl ?? '' });
        try {
            const app = await server.createProject('app');
            expect(await (await fetch(`${server.url}/health`)).json()).toEqual({ status: 'ok' });
            const socket = server.connect(app);
            await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
            await socket.emitWithAck(SOCKET_EVENTS.subscribe, { channel: 'live' });
            const received: SocketMessage[] = [];
            socket.on(SOCKET_EVENTS.message, (message: SocketMessage) => received.push(message));
            expect(
                (
                    await server.request(app, 'POST', '/v1/messages', {
                        channels: ['live'],
                        event: 'tick',
                    })
                ).status,
            ).toBe(202);
            await expect.poll(() => received).toEqual([{ channel: 'live', event: 'tick' }]);
        } finally {
            await server.close();
        }
    });
});

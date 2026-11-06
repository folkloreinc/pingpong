import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SOCKET_EVENTS } from '@pingpong-io/protocol';
import type { Channel, Problem, SocketMessage } from '@pingpong-io/protocol';
import { signRequest } from '@pingpong-io/protocol/signatures';

import { startTestServer } from '../testing.ts';
import type { TestProject, TestServer } from '../testing.ts';

function connected(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
    });
}

async function problem(response: Response): Promise<Problem> {
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    return (await response.json()) as Problem;
}

const message = { channels: ['comments.article-1'], event: 'comment.created', data: { id: 42 } };

describe('the HTTP API', () => {
    let server: TestServer;
    let app: TestProject;

    beforeEach(async () => {
        server = await startTestServer();
        app = await server.createProject('app', { origins: ['https://example.com'] });
    });

    afterEach(async () => {
        await server.close();
    });

    describe('signatures', () => {
        it('refuse a request without a key or a signature', async () => {
            const response = await fetch(`${server.url}/v1/origins`);
            expect(response.status).toBe(401);
            expect((await problem(response)).detail).toMatch(/Pingpong-Key/);

            const unsigned = await fetch(`${server.url}/v1/origins`, {
                headers: { 'Pingpong-Key': app.project.key },
            });
            expect((await problem(unsigned)).detail).toMatch(/missing or malformed/);
        });

        it('refuse a wrong secret, an old timestamp and an unknown or disabled key', async () => {
            const wrong = await server.request(app, 'GET', '/v1/origins', undefined, {
                secret: 'sk_x',
            });
            expect((await problem(wrong)).detail).toMatch(/doesn't match/);

            const old = await server.request(app, 'GET', '/v1/origins', undefined, {
                timestamp: Math.floor(Date.now() / 1000) - 600,
            });
            expect((await problem(old)).detail).toMatch(/five minutes/);

            await server.server.projects.update('app', { disabled: true });
            expect((await server.request(app, 'GET', '/v1/origins')).status).toBe(401);
        });

        it('accept the previous secret during the grace period', async () => {
            const { secret } = await server.server.projects.rotateSecret('app', 60);
            expect((await server.request(app, 'GET', '/v1/origins')).status).toBe(200);
            expect(
                (await server.request(app, 'GET', '/v1/origins', undefined, { secret })).status,
            ).toBe(200);
        });

        it('cover the body', async () => {
            const signature = signRequest(app.secret, {
                method: 'POST',
                path: '/v1/messages',
                body: JSON.stringify(message),
            });
            const response = await fetch(`${server.url}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Pingpong-Key': app.project.key,
                    'Pingpong-Signature': signature,
                },
                body: JSON.stringify({ ...message, event: 'other' }),
            });
            expect(response.status).toBe(401);
        });
    });

    describe('POST /v1/messages', () => {
        it('sends the message to the subscribers of its channels, except one socket', async () => {
            const reader = server.connect(app);
            const writer = server.connect(app);
            await Promise.all([connected(reader), connected(writer)]);
            for (const socket of [reader, writer]) {
                await socket.emitWithAck(SOCKET_EVENTS.subscribe, {
                    channel: 'comments.article-1',
                });
            }
            const received: SocketMessage[] = [];
            const writerReceived: SocketMessage[] = [];
            reader.on(SOCKET_EVENTS.message, (payload: SocketMessage) => received.push(payload));
            writer.on(SOCKET_EVENTS.message, (payload: SocketMessage) =>
                writerReceived.push(payload),
            );

            const response = await server.request(app, 'POST', '/v1/messages', {
                ...message,
                exceptSocketId: writer.id,
            });
            expect(response.status).toBe(202);

            await expect
                .poll(() => received)
                .toEqual([
                    { channel: 'comments.article-1', event: 'comment.created', data: { id: 42 } },
                ]);
            expect(writerReceived).toEqual([]);
        });

        it('answers 422 with the errors by pointer', async () => {
            const response = await server.request(app, 'POST', '/v1/messages', {
                channels: ['a b'],
                event: 'e',
                extra: true,
            });
            expect(response.status).toBe(422);
            expect((await problem(response)).errors).toMatchObject({
                '/channels/0': expect.any(Array),
                '/extra': expect.any(Array),
            });
        });

        it('answers 400 to invalid JSON', async () => {
            const response = await fetch(`${server.url}/v1/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{',
            });
            expect(response.status).toBe(400);
        });

        it("refuses a message larger than the project's limit", async () => {
            await server.server.projects.update('app', { limits: { maxMessageSize: 100 } });
            const response = await server.request(app, 'POST', '/v1/messages', {
                ...message,
                data: 'x'.repeat(200),
            });
            expect(response.status).toBe(413);
            expect((await problem(response)).detail).toMatch(/limit of 100/);
        });

        it('limits the messages per second, one per channel', async () => {
            await server.server.projects.update('app', { limits: { maxMessagesPerSecond: 3 } });
            const twoChannels = { ...message, channels: ['a', 'b'] };
            expect((await server.request(app, 'POST', '/v1/messages', twoChannels)).status).toBe(
                202,
            );
            const refused = await server.request(app, 'POST', '/v1/messages', twoChannels);
            expect(refused.status).toBe(429);
            expect(Number(refused.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
        });
    });

    describe('POST /v1/messages/batch', () => {
        it('publishes the messages in order', async () => {
            const socket = server.connect(app);
            await connected(socket);
            await socket.emitWithAck(SOCKET_EVENTS.subscribe, { channel: 'live' });
            const events: string[] = [];
            socket.on(SOCKET_EVENTS.message, (payload: SocketMessage) =>
                events.push(payload.event),
            );

            const response = await server.request(app, 'POST', '/v1/messages/batch', {
                messages: ['one', 'two', 'three'].map((event) => ({ channels: ['live'], event })),
            });
            expect(response.status).toBe(202);
            await expect.poll(() => events).toEqual(['one', 'two', 'three']);
        });

        it('points at the invalid message', async () => {
            const response = await server.request(app, 'POST', '/v1/messages/batch', {
                messages: [message, { event: 'e' }],
            });
            expect((await problem(response)).errors).toHaveProperty(['/messages/1/channels']);
        });
    });

    describe('GET /v1/channels/{channel}', () => {
        it('counts the sockets subscribed to a channel', async () => {
            const read = async (channel: string) =>
                (await (
                    await server.request(app, 'GET', `/v1/channels/${channel}`)
                ).json()) as Channel;
            expect(await read('comments.article-1')).toEqual({
                channel: 'comments.article-1',
                occupied: false,
                subscriptionCount: 0,
            });
            const sockets = [server.connect(app), server.connect(app)];
            await Promise.all(sockets.map(connected));
            for (const socket of sockets) {
                await socket.emitWithAck(SOCKET_EVENTS.subscribe, {
                    channel: 'comments.article-1',
                });
            }
            expect(await read('comments.article-1')).toMatchObject({
                occupied: true,
                subscriptionCount: 2,
            });
            expect((await server.request(app, 'GET', '/v1/channels/a%20b')).status).toBe(422);
        });
    });

    describe('/v1/origins', () => {
        it('reads and replaces the origins', async () => {
            expect(await (await server.request(app, 'GET', '/v1/origins')).json()).toEqual({
                origins: ['https://example.com'],
            });
            const response = await server.request(app, 'PUT', '/v1/origins', {
                origins: ['https://example.com', 'https://*.contest.test'],
            });
            expect(await response.json()).toEqual({
                origins: ['https://example.com', 'https://*.contest.test'],
            });
            const socket = server.connect(app, undefined, {
                extraHeaders: { origin: 'https://a.contest.test' },
            });
            await expect(connected(socket)).resolves.toBeUndefined();
            const invalid = await server.request(app, 'PUT', '/v1/origins', { origins: ['nope'] });
            expect(invalid.status).toBe(422);
        });
    });

    it('answers /health without a signature, and problems to unknown routes', async () => {
        expect(await (await fetch(`${server.url}/health`)).json()).toEqual({ status: 'ok' });
        const missing = await fetch(`${server.url}/v2/anything`);
        expect(missing.status).toBe(404);
        expect((await problem(missing)).title).toBe('Not Found');
    });
});

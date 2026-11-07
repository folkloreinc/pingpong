import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SOCKET_EVENTS } from '@pingpong-io/protocol';
import type {
    SocketConnected,
    SocketMessage,
    SocketSubscribeResult,
    SocketSubscriptionCount,
} from '@pingpong-io/protocol';
import { signChannel } from '@pingpong-io/protocol/signatures';

import { startTestServer } from '../testing.ts';
import type { TestProject, TestServer } from '../testing.ts';

function connected(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
    });
}

function subscribe(socket: Socket, request: unknown): Promise<SocketSubscribeResult> {
    return socket.timeout(2000).emitWithAck(SOCKET_EVENTS.subscribe, request);
}

describe('Socket.IO', () => {
    let server: TestServer;
    let app: TestProject;
    let other: TestProject;

    beforeEach(async () => {
        server = await startTestServer();
        app = await server.createProject('app', { origins: ['https://example.com'] });
        other = await server.createProject('other');
    });

    afterEach(async () => {
        await server.close();
    });

    describe('connections', () => {
        it('need the project key, an allowed origin and an enabled project', async () => {
            const refused = async (socket: Socket) => {
                const error = await connected(socket).then(
                    () => null,
                    (reason: Error) => reason.message,
                );
                socket.disconnect();
                return error;
            };
            const options = { reconnection: false };
            expect(await refused(server.connect('missing', app.project.key, options))).toBe(
                'unknown_project',
            );
            expect(await refused(server.connect('app', other.project.key, options))).toBe(
                'invalid_key',
            );
            expect(
                await refused(
                    server.connect(app, undefined, {
                        ...options,
                        extraHeaders: { origin: 'https://evil.test' },
                    }),
                ),
            ).toBe('origin_not_allowed');
            expect(
                await refused(
                    server.connect(app, undefined, {
                        ...options,
                        extraHeaders: { origin: 'https://example.com' },
                    }),
                ),
            ).toBeNull();
            expect(await refused(io(server.url, { forceNew: true, ...options }))).toBe(
                'unknown_project',
            );

            await server.server.projects.update('app', { disabled: true });
            expect(await refused(server.connect(app, undefined, options))).toBe('project_disabled');
        });

        it("keep no namespace for a project that doesn't exist", async () => {
            const namespaces = () => [...server.server.realtime.io._nsps.keys()].sort();
            const before = namespaces();
            const attempts = Array.from({ length: 20 }, (_, index) =>
                connected(
                    server.connect(`missing-${index}`, 'pk_unknown', { reconnection: false }),
                ).then(
                    () => null,
                    (reason: Error) => reason.message,
                ),
            );
            expect(new Set(await Promise.all(attempts))).toEqual(new Set(['unknown_project']));
            expect(namespaces()).toEqual(before);

            // A project created after a refused attempt gets its namespace back.
            const late = await server.createProject('missing-0');
            await connected(server.connect(late));
            expect(namespaces()).toContain('/projects/missing-0');
        });

        it("stop at the project's limit of connections", async () => {
            await server.server.projects.update('app', { limits: { maxConnections: 1 } });
            await connected(server.connect(app));
            await expect(
                connected(server.connect(app, undefined, { reconnection: false })),
            ).rejects.toThrow('too_many_connections');
        });

        it('start with pingpong:connected', async () => {
            const socket = server.connect(app);
            const first = new Promise<SocketConnected>((resolve) =>
                socket.once(SOCKET_EVENTS.connected, resolve),
            );
            await connected(socket);
            expect(await first).toEqual({ socketId: socket.id, recovered: false });
        });
    });

    describe('subscriptions', () => {
        it('join public channels, and private ones with the signature of the socket', async () => {
            const socket = server.connect(app);
            await connected(socket);
            const id = socket.id as string;
            expect(await subscribe(socket, { channel: 'comments.article-1' })).toEqual({
                ok: true,
                subscriptionCount: 1,
            });
            expect(await subscribe(socket, { channel: 'private-users.42' })).toEqual({
                ok: false,
                error: 'invalid_signature',
            });
            expect(
                await subscribe(socket, {
                    channel: 'private-users.42',
                    signature: signChannel(other.secret, id, 'private-users.42'),
                }),
            ).toEqual({ ok: false, error: 'invalid_signature' });
            expect(
                await subscribe(socket, {
                    channel: 'private-users.42',
                    signature: signChannel(app.secret, id, 'private-users.42'),
                }),
            ).toEqual({ ok: true, subscriptionCount: 1 });
        });

        it('refuse presence channels, invalid requests and too many channels', async () => {
            await server.server.projects.update('app', { limits: { maxChannelsPerSocket: 2 } });
            const socket = server.connect(app);
            await connected(socket);
            expect(await subscribe(socket, { channel: 'presence-room.1' })).toEqual({
                ok: false,
                error: 'unsupported_channel',
            });
            expect(await subscribe(socket, { channel: 'a b' })).toEqual({
                ok: false,
                error: 'invalid_request',
            });
            expect(await subscribe(socket, 'nope')).toEqual({
                ok: false,
                error: 'invalid_request',
            });
            expect((await subscribe(socket, { channel: 'one' })).ok).toBe(true);
            expect((await subscribe(socket, { channel: 'two' })).ok).toBe(true);
            expect((await subscribe(socket, { channel: 'two' })).ok).toBe(true);
            expect(await subscribe(socket, { channel: 'three' })).toEqual({
                ok: false,
                error: 'too_many_channels',
            });
            expect(await socket.emitWithAck(SOCKET_EVENTS.unsubscribe, { channel: 'one' })).toEqual(
                { ok: true },
            );
            expect((await subscribe(socket, { channel: 'three' })).ok).toBe(true);
        });
    });

    describe('messages', () => {
        it('reach the subscribers of a channel of the project, once per channel', async () => {
            const subscriber = server.connect(app);
            const stranger = server.connect(other);
            await Promise.all([connected(subscriber), connected(stranger)]);
            await subscribe(subscriber, { channel: 'a' });
            await subscribe(subscriber, { channel: 'b' });
            await subscribe(stranger, { channel: 'a' });
            const received: SocketMessage[] = [];
            const strangerReceived: SocketMessage[] = [];
            subscriber.on(SOCKET_EVENTS.message, (message: SocketMessage) =>
                received.push(message),
            );
            stranger.on(SOCKET_EVENTS.message, (message: SocketMessage) =>
                strangerReceived.push(message),
            );

            server.server.realtime.publish('app', { channels: ['a', 'b', 'c'], event: 'tick' });

            await expect
                .poll(() => received)
                .toEqual([
                    { channel: 'a', event: 'tick' },
                    { channel: 'b', event: 'tick' },
                ]);
            expect(strangerReceived).toEqual([]);
        });
    });

    describe('subscription counts', () => {
        it('reach the subscribers when the count changes', async () => {
            const first = server.connect(app);
            await connected(first);
            const counts: number[] = [];
            first.on(
                SOCKET_EVENTS.subscriptionCount,
                ({ subscriptionCount }: SocketSubscriptionCount) => counts.push(subscriptionCount),
            );
            await subscribe(first, { channel: 'comments.article-1' });
            await expect.poll(() => counts).toEqual([1]);

            const second = server.connect(app);
            await connected(second);
            await subscribe(second, { channel: 'comments.article-1' });
            await expect.poll(() => counts).toEqual([1, 2]);

            second.disconnect();
            await expect.poll(() => counts).toEqual([1, 2, 1]);
        });
    });

    describe('recovery', () => {
        it('gives back the channels and the missed messages after a short disconnection', async () => {
            const socket = server.connect(app);
            await connected(socket);
            const id = socket.id as string;
            await subscribe(socket, {
                channel: 'private-users.42',
                signature: signChannel(app.secret, id, 'private-users.42'),
            });
            const received: SocketMessage[] = [];
            socket.on(SOCKET_EVENTS.message, (message: SocketMessage) => received.push(message));
            const reconnected = new Promise<SocketConnected>((resolve) =>
                socket.on(SOCKET_EVENTS.connected, (payload: SocketConnected) => {
                    if (payload.recovered) {
                        resolve(payload);
                    }
                }),
            );

            // Cut the transport from the client side, as a network drop would.
            const disconnected = new Promise((resolve) => socket.once('disconnect', resolve));
            socket.io.engine.close();
            await disconnected;
            server.server.realtime.publish('app', {
                channels: ['private-users.42'],
                event: 'missed',
            });

            expect(await reconnected).toEqual({ socketId: id, recovered: true });
            expect(socket.recovered).toBe(true);
            await expect.poll(() => received.map((message) => message.event)).toEqual(['missed']);
        });
    });
});

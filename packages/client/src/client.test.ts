import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { signChannel } from '@pingpong-io/protocol/signatures';
import { startTestServer } from '@pingpong-io/server/testing';
import type { TestProject, TestServer } from '@pingpong-io/server/testing';

import { Pingpong } from './index.ts';
import type { Authorizer, PingpongOptions, SocketMessage, SubscriptionError } from './index.ts';

function once<T>(subscribe: (listener: (payload: T) => void) => unknown): Promise<T> {
    return new Promise((resolve) => subscribe(resolve));
}

describe('Pingpong', () => {
    let server: TestServer;
    let app: TestProject;
    const clients: Pingpong[] = [];

    /** What the application does: it signs the channels the user may join. */
    const authorize: Authorizer = async ({ socketId, channel }) => {
        if (channel === 'private-forbidden') {
            throw new Error('403');
        }
        return signChannel(app.secret, socketId, channel);
    };

    function client(options: Partial<PingpongOptions> = {}): Pingpong {
        const pingpong = new Pingpong({
            url: server.url,
            project: 'app',
            key: app.project.key,
            authorize,
            socketOptions: { reconnectionDelay: 50, reconnectionDelayMax: 100 },
            ...options,
        });
        clients.push(pingpong);
        return pingpong;
    }

    beforeEach(async () => {
        server = await startTestServer();
        app = await server.createProject('app');
    });

    afterEach(async () => {
        clients.splice(0).forEach((pingpong) => pingpong.close());
        await server.close();
    });

    const publish = (channels: string[], event: string, data?: unknown) =>
        server.request(app, 'POST', '/v1/messages', {
            channels,
            event,
            ...(data === undefined ? {} : { data }),
        });

    it('subscribes before or after connecting, and receives messages', async () => {
        const pingpong = client({ autoConnect: false });
        const early: SocketMessage[] = [];
        const subscription = pingpong.subscribe('comments.article-1', (message) =>
            early.push(message),
        );
        expect(subscription.state).toBe('pending');
        pingpong.connect();
        await once((listener) => subscription.on('subscribed', listener));
        expect(subscription.state).toBe('subscribed');
        expect(subscription.subscriptionCount).toBe(1);

        const late = pingpong.subscribe('live');
        await once((listener) => late.on('subscribed', listener));
        const lateMessages: SocketMessage[] = [];
        late.on('message', (message) => lateMessages.push(message));

        await publish(['comments.article-1', 'live'], 'comment.created', { id: 1 });
        await expect
            .poll(() => early)
            .toEqual([
                { channel: 'comments.article-1', event: 'comment.created', data: { id: 1 } },
            ]);
        await expect.poll(() => lateMessages.map((message) => message.channel)).toEqual(['live']);
    });

    it('subscribes to private channels with the signature of the application', async () => {
        const pingpong = client();
        const subscription = pingpong.subscribe('private-users.42');
        await once((listener) => subscription.on('subscribed', listener));
        const forbidden = pingpong.subscribe('private-forbidden');
        const error = await once<SubscriptionError>((listener) => forbidden.on('error', listener));
        expect(error.code).toBe('authorization_failed');
        expect(forbidden.state).toBe('failed');

        const unsigned = client({ authorize: undefined }).subscribe('private-users.42');
        expect(
            (await once<SubscriptionError>((listener) => unsigned.on('error', listener))).code,
        ).toBe('authorization_failed');
    });

    it("reports the server's refusals", async () => {
        const presence = client().subscribe('presence-room.1');
        expect(await once<SubscriptionError>((listener) => presence.on('error', listener))).toEqual(
            {
                code: 'unsupported_channel',
            },
        );
    });

    it('shares one server subscription between subscriptions to a channel', async () => {
        const pingpong = client();
        const first = pingpong.subscribe('live');
        await once((listener) => first.on('subscribed', listener));
        const second = pingpong.subscribe('live');
        await once((listener) => second.on('subscribed', listener));
        expect(second.state).toBe('subscribed');

        const received: string[] = [];
        first.on('message', () => received.push('first'));
        second.on('message', () => received.push('second'));
        await publish(['live'], 'tick');
        await expect.poll(() => received.sort()).toEqual(['first', 'second']);

        first.unsubscribe();
        expect(pingpong.channels).toEqual(['live']);
        second.unsubscribe();
        expect(pingpong.channels).toEqual([]);
        await expect
            .poll(
                async () =>
                    (await (
                        await server.request(app, 'GET', '/v1/channels/live')
                    ).json()) as unknown,
            )
            .toMatchObject({ subscriptionCount: 0 });
    });

    it('follows subscription counts', async () => {
        const first = client().subscribe('comments.article-1');
        const counts: number[] = [];
        first.on('subscriptionCount', (count) => counts.push(count));
        await once((listener) => first.on('subscribed', listener));
        const second = client().subscribe('comments.article-1');
        await once((listener) => second.on('subscribed', listener));
        await expect.poll(() => counts.at(-1)).toBe(2);
        expect(first.subscriptionCount).toBe(2);
    });

    it('keeps its channels when the socket is recovered', async () => {
        const pingpong = client();
        const subscription = pingpong.subscribe('private-users.42');
        await once((listener) => subscription.on('subscribed', listener));
        const resets: unknown[] = [];
        pingpong.on('reset', () => resets.push(true));
        const received: string[] = [];
        subscription.on('message', (message) => received.push(message.event));

        const disconnected = once((listener) => pingpong.on('disconnected', listener));
        pingpong.socket.io.engine.close();
        await disconnected;
        await publish(['private-users.42'], 'missed');

        const connected = await once<{ recovered: boolean }>((listener) =>
            pingpong.on('connected', listener),
        );
        expect(connected.recovered).toBe(true);
        await expect.poll(() => received).toEqual(['missed']);
        expect(resets).toEqual([]);
    });

    it('subscribes again with new signatures and emits reset when it is not recovered', async () => {
        await server.close();
        server = await startTestServer({ PINGPONG_RECOVERY_WINDOW: '0' });
        app = await server.createProject('app');
        const pingpong = client();
        const subscription = pingpong.subscribe('private-users.42');
        await once((listener) => subscription.on('subscribed', listener));
        const firstId = pingpong.socket.id;

        const reset = once((listener) => pingpong.on('reset', listener));
        pingpong.socket.io.engine.close();
        await reset;
        await once((listener) => subscription.on('subscribed', listener));
        expect(pingpong.socket.id).not.toBe(firstId);

        const received: string[] = [];
        subscription.on('message', (message) => received.push(message.event));
        await publish(['private-users.42'], 'after');
        await expect.poll(() => received).toEqual(['after']);
    });

    it('stops on final connection errors', async () => {
        const pingpong = client({ key: 'pk_wrong-key-0000000000' });
        const error = await once<{ code: string }>((listener) => pingpong.on('error', listener));
        expect(error.code).toBe('invalid_key');
        expect(pingpong.connected).toBe(false);
    });

    it('connects again after too_many_connections', async () => {
        await server.server.projects.update('app', { limits: { maxConnections: 1 } });
        const first = client();
        await once((listener) => first.on('connected', listener));
        const second = client({ retryDelay: 50 });
        expect(
            (await once<{ code: string }>((listener) => second.on('error', listener))).code,
        ).toBe('too_many_connections');
        first.close();
        await once((listener) => second.on('connected', listener));
        expect(second.connected).toBe(true);
    });
});

import { createAdapter } from '@socket.io/redis-streams-adapter';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';

import { collectMessages, connectClient, connected, once, subscribe, waitUntil } from './client.ts';
import { startProxy } from './proxy.ts';
import type { Proxy } from './proxy.ts';
import { startSpikeServer } from './server.ts';
import type { Message, SpikeServer } from './server.ts';
import { signChannel } from './signature.ts';

const project = { id: 'alpha', key: 'alpha-key', secret: 'alpha-secret', origins: [] };
const redisUrl = process.env.PINGPONG_TEST_REDIS_URL;
const transports = ['websocket', 'polling'] as const;
type Transport = (typeof transports)[number];

const message = (channel: string, index: number): Message => ({
    channel,
    event: 'tick',
    data: { index },
});

const sleep = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));

describe('connection state recovery through a proxy', () => {
    const cleanups: (() => unknown)[] = [];

    afterEach(async () => {
        for (const cleanup of cleanups.splice(0).reverse()) {
            await cleanup();
        }
    });

    async function setUp(
        transport: Transport,
        ...serverArgs: Parameters<typeof startSpikeServer> extends [unknown, ...infer Rest]
            ? Rest
            : never
    ): Promise<{ server: SpikeServer; proxy: Proxy; socket: Socket; messages: Message[] }> {
        const server = await startSpikeServer([project], ...serverArgs);
        cleanups.push(() => server.close());
        const proxy = await startProxy(server.port);
        cleanups.push(() => proxy.close());
        const socket = connectClient(proxy.url, 'alpha', 'alpha-key', { transports: [transport] });
        cleanups.push(() => socket.disconnect());
        await connected(socket);
        await subscribe(socket, { channel: 'comments.article-1' });
        await subscribe(socket, {
            channel: 'private-users.42',
            signature: signChannel(project.secret, socket.id as string, 'private-users.42'),
        });
        return { server, proxy, socket, messages: collectMessages(socket) };
    }

    /** Cuts the network, publishes while the client is away, and waits for it to come back. */
    async function outage(
        socket: Socket,
        proxy: Proxy,
        duration: number,
        whileAway: () => void,
    ): Promise<void> {
        const disconnected = once(socket, 'disconnect');
        const reconnected = once(socket, 'connect');
        const interrupted = proxy.interrupt(duration);
        await disconnected;
        whileAway();
        await interrupted;
        await reconnected;
    }

    // The server only restores a session it has closed. Through a proxy, it may not see the drop
    // until the ping times out (pingInterval + pingTimeout): the outage lasts longer than that.
    const fastPings = { pingInterval: 100, pingTimeout: 100 };

    for (const transport of transports) {
        it(`replays what a ${transport} client missed, and keeps its channels`, async () => {
            const { server, proxy, socket, messages } = await setUp(transport, fastPings);
            const id = socket.id;

            await outage(socket, proxy, 500, () => {
                for (let index = 1; index <= 3; index++) {
                    server.publish('alpha', message('comments.article-1', index));
                    server.publish('alpha', message('private-users.42', index));
                }
            });

            expect(socket.recovered).toBe(true);
            expect(socket.id).toBe(id);
            await waitUntil(() => messages.length === 6);
            expect(messages.filter((m) => m.channel === 'comments.article-1')).toEqual(
                [1, 2, 3].map((index) => message('comments.article-1', index)),
            );

            server.publish('alpha', message('private-users.42', 4));
            await waitUntil(() => messages.length === 7);
        });
    }

    it('needs a first broadcast packet to recover a client that received nothing', async () => {
        const { server, proxy, socket, messages } = await setUp(
            'websocket',
            {},
            { connectedPacket: false },
        );

        await outage(socket, proxy, 300, () => {
            server.publish('alpha', message('comments.article-1', 1));
        });

        expect(socket.recovered).toBe(false);
        await sleep(200);
        expect(messages).toEqual([]);
    });

    it('starts over after the recovery window, without the channels', async () => {
        const { server, proxy, socket, messages } = await setUp('websocket', {
            connectionStateRecovery: { maxDisconnectionDuration: 200, skipMiddlewares: true },
        });

        await outage(socket, proxy, 600, () => {
            server.publish('alpha', message('comments.article-1', 1));
        });

        expect(socket.recovered).toBe(false);
        server.publish('alpha', message('comments.article-1', 2));
        await sleep(200);
        expect(messages).toEqual([]);
    });

    describe.runIf(redisUrl)('with the Redis Streams adapter', () => {
        async function redisAdapter(streamName: string) {
            const redis = createClient({ url: redisUrl });
            await redis.connect();
            cleanups.push(() => redis.quit());
            return createAdapter(redis, { streamName });
        }

        it('recovers on another server', async () => {
            const streamName = `pingpong-spike-${randomUUID()}`;
            const { proxy, socket, messages } = await setUp('websocket', {
                adapter: await redisAdapter(streamName),
            });
            const id = socket.id;
            const other = await startSpikeServer([project], {
                adapter: await redisAdapter(streamName),
            });
            cleanups.push(() => other.close());

            proxy.setTarget(other.port);
            await outage(socket, proxy, 300, () => {
                for (let index = 1; index <= 3; index++) {
                    other.publish('alpha', message('private-users.42', index));
                }
            });

            expect(socket.recovered).toBe(true);
            expect(socket.id).toBe(id);
            await waitUntil(() => messages.length === 3);

            other.publish('alpha', message('comments.article-1', 4));
            await waitUntil(() => messages.length === 4);
        });
    });
});

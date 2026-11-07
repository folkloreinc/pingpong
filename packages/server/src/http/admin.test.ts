import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SOCKET_EVENTS, validate } from '@pingpong-io/protocol';
import type {
    AdminChannelList,
    AdminProject,
    AdminProjectCreated,
    AdminProjectList,
    AdminProjectSecret,
    Channel,
    Problem,
    ServerStatus,
    SocketSubscribeResult,
} from '@pingpong-io/protocol';
import { signRequest } from '@pingpong-io/protocol/signatures';

import { startTestServer } from '../testing.ts';
import type { TestProject, TestServer } from '../testing.ts';
import { VERSION } from '../version.ts';

const TOKEN = 'a'.repeat(64);

function connected(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
    });
}

function subscribe(socket: Socket, channel: string): Promise<SocketSubscribeResult> {
    return new Promise((resolve) => socket.emit(SOCKET_EVENTS.subscribe, { channel }, resolve));
}

describe('the admin API', () => {
    let server: TestServer;
    let app: TestProject;

    /** A request to the admin API with the admin token. */
    const admin = (method: string, path: string, body?: unknown, token = TOKEN) =>
        fetch(`${server.url}/admin/v1${path}`, {
            method,
            headers: {
                authorization: `Bearer ${token}`,
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

    beforeEach(async () => {
        server = await startTestServer({ PINGPONG_ADMIN_TOKEN: TOKEN });
        app = await server.createProject('app', {
            name: 'App',
            origins: ['https://example.com'],
            limits: { maxConnections: 50 },
        });
    });

    afterEach(async () => {
        await server.close();
    });

    describe('the admin token', () => {
        it('is required, and compared whole', async () => {
            const none = await fetch(`${server.url}/admin/v1/projects`);
            expect(none.status).toBe(401);
            expect(none.headers.get('www-authenticate')).toMatch(/^Bearer/);
            expect(none.headers.get('cache-control')).toBe('no-store');
            expect(((await none.json()) as Problem).detail).toMatch(/Authorization: Bearer/);

            expect((await admin('GET', '/projects', undefined, 'b'.repeat(64))).status).toBe(401);
            expect((await admin('GET', '/projects', undefined, TOKEN.slice(1))).status).toBe(401);
            expect((await admin('GET', '/projects', undefined, `${TOKEN}a`)).status).toBe(401);
        });

        it("isn't a project's key and signature", async () => {
            const response = await server.request(app, 'GET', '/admin/v1/projects');
            expect(response.status).toBe(401);
        });

        it('answers responses that nothing caches', async () => {
            const response = await admin('GET', '/projects');
            expect(response.status).toBe(200);
            expect(response.headers.get('cache-control')).toBe('no-store');
        });
    });

    it("doesn't exist without an admin token", async () => {
        const plain = await startTestServer();
        try {
            const response = await fetch(`${plain.url}/admin/v1/projects`, {
                headers: { authorization: `Bearer ${TOKEN}` },
            });
            expect(response.status).toBe(404);
        } finally {
            await plain.close();
        }
    });

    describe('projects', () => {
        it('lists them, without their secrets', async () => {
            await server.createProject('another');
            const response = await admin('GET', '/projects');
            const body = (await response.json()) as AdminProjectList;
            expect(validate('AdminProjectList', body)).toMatchObject({ valid: true });
            expect(body.projects.map((project) => project.id)).toEqual(['another', 'app']);
            expect(JSON.stringify(body)).not.toContain(app.secret);
        });

        it('shows one, with its own limits and the defaults', async () => {
            const response = await admin('GET', '/projects/app');
            const project = (await response.json()) as AdminProject;
            expect(validate('AdminProject', project)).toMatchObject({ valid: true });
            expect(project).toMatchObject({
                id: 'app',
                name: 'App',
                key: app.project.key,
                disabled: false,
                origins: ['https://example.com'],
                ownLimits: { maxConnections: 50 },
                limits: { maxConnections: 50, maxMessageSize: 10_240 },
                previousSecretExpiresAt: null,
            });
            expect(JSON.stringify(project)).not.toContain(app.secret);
            expect((await admin('GET', '/projects/nope')).status).toBe(404);
            expect((await admin('GET', '/projects/Not%20an%20id')).status).toBe(404);
        });

        it('creates one, and shows its secret this once', async () => {
            const response = await admin('POST', '/projects', {
                id: 'new-app',
                name: 'New app',
                origins: ['https://*.example.org'],
                limits: { maxMessagesPerSecond: 10 },
            });
            expect(response.status).toBe(201);
            const created = (await response.json()) as AdminProjectCreated;
            expect(validate('AdminProjectCreated', created)).toMatchObject({ valid: true });
            expect(created.project).toMatchObject({
                id: 'new-app',
                name: 'New app',
                origins: ['https://*.example.org'],
                ownLimits: { maxMessagesPerSecond: 10 },
            });
            expect((await server.server.projects.get('new-app')).secrets).toEqual([created.secret]);
            const shown = await (await admin('GET', '/projects/new-app')).text();
            expect(shown).not.toContain(created.secret);
        });

        it('refuses an id that is taken, and invalid values', async () => {
            const taken = await admin('POST', '/projects', { id: 'app' });
            expect(taken.status).toBe(409);
            const invalid = await admin('POST', '/projects', {
                id: 'Bad Id',
                origins: ['example.com'],
                key: 'pk_mine',
            });
            expect(invalid.status).toBe(422);
            expect(Object.keys(((await invalid.json()) as Problem).errors ?? {}).sort()).toEqual([
                '/id',
                '/key',
                '/origins/0',
            ]);
            expect((await admin('POST', '/projects')).status).toBe(422);
        });

        it('changes what the request has, and leaves the rest', async () => {
            const response = await admin('PATCH', '/projects/app', {
                name: 'Renamed',
                limits: { maxConnections: null, maxChannelsPerSocket: 5 },
            });
            const project = (await response.json()) as AdminProject;
            expect(project).toMatchObject({
                name: 'Renamed',
                origins: ['https://example.com'],
                ownLimits: { maxChannelsPerSocket: 5 },
                limits: { maxConnections: 10_000, maxChannelsPerSocket: 5 },
            });
            const cleared = (await (
                await admin('PATCH', '/projects/app', { origins: [] })
            ).json()) as AdminProject;
            expect(cleared.origins).toEqual([]);
            expect((await admin('PATCH', '/projects/app', {})).status).toBe(422);
            expect((await admin('PATCH', '/projects/app', { key: 'pk_x' })).status).toBe(422);
            expect((await admin('PATCH', '/projects/nope', { name: 'x' })).status).toBe(404);
        });

        it('disconnects the sockets of a project it disables, and refuses new ones', async () => {
            const socket = server.connect(app, undefined, {
                extraHeaders: { origin: 'https://example.com' },
            });
            await connected(socket);
            const disconnected = new Promise<string>((resolve) =>
                socket.once('disconnect', resolve),
            );
            const response = await admin('PATCH', '/projects/app', { disabled: true });
            expect(((await response.json()) as AdminProject).disabled).toBe(true);
            expect(await disconnected).toBe('io server disconnect');

            const again = server.connect(app, undefined, {
                reconnection: false,
                extraHeaders: { origin: 'https://example.com' },
            });
            await expect(connected(again)).rejects.toThrow('project_disabled');
            const published = await server.request(app, 'POST', '/v1/messages', {
                channels: ['a'],
                event: 'e',
            });
            expect(published.status).toBe(401);

            await admin('PATCH', '/projects/app', { disabled: false });
            const back = server.connect(app, undefined, {
                extraHeaders: { origin: 'https://example.com' },
            });
            await connected(back);
        });

        it('deletes one and disconnects its sockets', async () => {
            const socket = server.connect(app, undefined, {
                extraHeaders: { origin: 'https://example.com' },
            });
            await connected(socket);
            const disconnected = new Promise<string>((resolve) =>
                socket.once('disconnect', resolve),
            );
            expect((await admin('DELETE', '/projects/app')).status).toBe(204);
            expect(await disconnected).toBe('io server disconnect');
            expect(await server.server.projects.find('app')).toBeUndefined();
            expect((await admin('DELETE', '/projects/app')).status).toBe(404);
        });
    });

    describe('rotating a secret', () => {
        it('gives a new secret once, and keeps the previous one for the grace period', async () => {
            const response = await admin('POST', '/projects/app/rotate-secret');
            const rotation = (await response.json()) as AdminProjectSecret;
            expect(validate('AdminProjectSecret', rotation)).toMatchObject({ valid: true });
            expect(rotation.secret).not.toBe(app.secret);
            const expiresAt = Date.parse(rotation.previousSecretExpiresAt ?? '');
            expect(expiresAt - Date.now()).toBeGreaterThan(86_300_000);

            // Both secrets sign requests, at once: the cache was invalidated.
            for (const secret of [app.secret, rotation.secret]) {
                const signed = await server.request(app, 'GET', '/v1/origins', undefined, {
                    secret,
                });
                expect(signed.status).toBe(200);
            }
            const project = (await (await admin('GET', '/projects/app')).json()) as AdminProject;
            expect(project.previousSecretExpiresAt).toBe(rotation.previousSecretExpiresAt);
            expect(JSON.stringify(project)).not.toContain(rotation.secret);
        });

        it('drops the previous secret now with a grace period of 0', async () => {
            const rotation = (await (
                await admin('POST', '/projects/app/rotate-secret', { gracePeriod: 0 })
            ).json()) as AdminProjectSecret;
            expect(rotation.previousSecretExpiresAt).toBeNull();
            const old = await server.request(app, 'GET', '/v1/origins');
            expect(old.status).toBe(401);
            expect(
                (await admin('POST', '/projects/app/rotate-secret', { gracePeriod: -1 })).status,
            ).toBe(422);
            expect((await admin('POST', '/projects/nope/rotate-secret')).status).toBe(404);
        });
    });

    describe('live state', () => {
        it('lists the channels of a project, most subscribed first', async () => {
            const sockets = [0, 1, 2].map(() =>
                server.connect(app, undefined, {
                    extraHeaders: { origin: 'https://example.com' },
                }),
            );
            await Promise.all(sockets.map(connected));
            const [first, second, third] = sockets as [Socket, Socket, Socket];
            await subscribe(first, 'comments.1');
            await subscribe(second, 'comments.1');
            await subscribe(third, 'comments.2');
            await subscribe(third, 'likes.1');

            const all = (await (
                await admin('GET', '/projects/app/channels')
            ).json()) as AdminChannelList;
            expect(validate('AdminChannelList', all)).toMatchObject({ valid: true });
            expect(all).toEqual({
                channels: [
                    { channel: 'comments.1', occupied: true, subscriptionCount: 2 },
                    { channel: 'comments.2', occupied: true, subscriptionCount: 1 },
                    { channel: 'likes.1', occupied: true, subscriptionCount: 1 },
                ],
                total: 3,
            });

            const some = (await (
                await admin('GET', '/projects/app/channels?prefix=comments.&limit=1')
            ).json()) as AdminChannelList;
            expect(some.channels.map(({ channel }) => channel)).toEqual(['comments.1']);
            expect(some.total).toBe(2);
            expect((await admin('GET', '/projects/app/channels?limit=501')).status).toBe(422);
            expect((await admin('GET', '/projects/nope/channels')).status).toBe(404);

            const one = (await (
                await admin('GET', '/projects/app/channels/comments.1')
            ).json()) as Channel;
            expect(one).toEqual({ channel: 'comments.1', occupied: true, subscriptionCount: 2 });
            const none = (await (
                await admin('GET', '/projects/app/channels/nobody')
            ).json()) as Channel;
            expect(none.occupied).toBe(false);
            expect((await admin('GET', '/projects/app/channels/a%20b')).status).toBe(422);
        });

        it('counts connections, refusals, messages and the rate limit since the start', async () => {
            await admin('PATCH', '/projects/app', { limits: { maxMessagesPerSecond: 2 } });
            const socket = server.connect(app, undefined, {
                extraHeaders: { origin: 'https://example.com' },
            });
            await connected(socket);
            const stranger = server.connect(app, undefined, {
                reconnection: false,
                extraHeaders: { origin: 'https://evil.example' },
            });
            await expect(connected(stranger)).rejects.toThrow('origin_not_allowed');
            const unknown = server.connect('nope', 'pk_nope', { reconnection: false });
            await expect(connected(unknown)).rejects.toThrow('unknown_project');

            const message = { channels: ['a', 'bc'], event: 'e', data: { id: 1 } };
            expect((await server.request(app, 'POST', '/v1/messages', message)).status).toBe(202);
            expect((await server.request(app, 'POST', '/v1/messages', message)).status).toBe(429);

            const project = (await (await admin('GET', '/projects/app')).json()) as AdminProject;
            const size = Buffer.byteLength(
                JSON.stringify({ channel: '', event: 'e', data: { id: 1 } }),
            );
            expect(project.stats).toMatchObject({
                connections: 1,
                peakConnections: 1,
                connectionsRefused: { origin_not_allowed: 1 },
                channels: 0,
                messages: 2,
                bytes: 2 * size + 'a'.length + 'bc'.length,
                rateLimited: 1,
            });
            expect(Date.parse(project.stats.since)).toBeLessThanOrEqual(Date.now());
        });

        it("shows the server's status", async () => {
            const socket = server.connect(app, undefined, {
                extraHeaders: { origin: 'https://example.com' },
            });
            await connected(socket);
            await subscribe(socket, 'comments.1');
            const status = (await (await admin('GET', '/status')).json()) as ServerStatus;
            expect(validate('ServerStatus', status)).toMatchObject({ valid: true });
            expect(status).toMatchObject({
                version: VERSION,
                healthy: true,
                projects: 1,
                connections: 1,
                channels: 1,
            });
            expect(status.checks.map(({ name, status: state }) => [name, state])).toEqual([
                ['database', 'ok'],
                ['migrations', 'ok'],
                ['secretKey', 'ok'],
                ['redis', 'skipped'],
            ]);
        });
    });

    it('keeps the signed /v1 API as it is', async () => {
        const body = '';
        const signature = signRequest(app.secret, { method: 'GET', path: '/v1/origins', body });
        const response = await fetch(`${server.url}/v1/origins`, {
            headers: { 'Pingpong-Key': app.project.key, 'Pingpong-Signature': signature },
        });
        expect(response.status).toBe(200);
    });
});

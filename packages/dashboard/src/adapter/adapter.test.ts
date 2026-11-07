import { NotFoundError, UnauthorizedError, ValidationError } from '@panneau/data';
import { describe, expect, it } from 'vitest';

import type { AdminProjectPatch } from '@pingpong-io/protocol';

import { MemoryStorage, json, mockFetch, problem } from '../testing/fetch.ts';
import type { Route } from '../testing/fetch.ts';
import { ADMIN_TOKEN, project } from '../testing/fixtures.ts';
import { type PingpongAdapterOptions, createPingpongAdapter } from './adapter.ts';
import { createTokenStore } from './token.ts';

const SECRET = 'sk_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';

function setup(
    options: Partial<PingpongAdapterOptions> = {},
    token: string | null = ADMIN_TOKEN,
    routes: Record<string, Route> = {},
) {
    const tokens = createTokenStore(new MemoryStorage());
    if (token !== null) {
        tokens.set(token);
    }
    const mock = mockFetch({
        'GET /admin/v1/projects': ({ headers }) =>
            headers.get('Authorization') === `Bearer ${ADMIN_TOKEN}`
                ? json(
                      { projects: [project(), project({ id: 'other', name: 'Other' })] },
                      { schema: 'AdminProjectList' },
                  )
                : problem(401, 'Unauthorized'),
        ...routes,
    });
    const adapter = createPingpongAdapter({ tokens, locale: 'en', fetch: mock.fetch, ...options });
    return { adapter, tokens, requests: mock.requests };
}

describe('createPingpongAdapter', () => {
    it('signs in with the admin token, and keeps it once the server accepts it', async () => {
        const { adapter, tokens, requests } = setup({}, null);
        await expect(adapter.login({ token: ` ${ADMIN_TOKEN} ` })).resolves.toEqual({
            user: { id: 'admin', name: 'Admin token' },
        });
        expect(tokens.get()).toBe(ADMIN_TOKEN);
        expect(requests[0]?.headers.get('Authorization')).toBe(`Bearer ${ADMIN_TOKEN}`);
    });

    it('refuses a token the server refuses, and keeps none', async () => {
        const { adapter, tokens } = setup({}, null);
        for (const token of ['wrong', '  ']) {
            const error: unknown = await adapter
                .login({ token })
                .catch((caught: unknown) => caught);
            expect(error).toBeInstanceOf(ValidationError);
            expect((error as ValidationError).errors).toEqual({
                token: ["This isn't the server's admin token."],
            });
        }
        await expect(
            adapter.login({ email: 'ops@example.com', password: ADMIN_TOKEN }),
        ).rejects.toBeInstanceOf(UnauthorizedError);
        expect(tokens.get()).toBeNull();
    });

    it('has no session without a token, or once the server refuses it', async () => {
        await expect(setup({}, null).adapter.getSession()).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
        await expect(setup({}, 'rotated').adapter.getSession()).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
        await expect(setup().adapter.getSession()).resolves.toEqual({
            user: { id: 'admin', name: 'Admin token' },
        });
    });

    it('forgets the token on logout', async () => {
        const { adapter, tokens } = setup();
        await adapter.logout();
        expect(tokens.get()).toBeNull();
    });

    it("gives a definition that Panneau accepts, in the operator's locale", async () => {
        for (const locale of ['en', 'fr'] as const) {
            const { adapter } = setup({ locale });
            const definition = await adapter.getDefinition();
            expect(definition).toMatchObject({
                protocol: 1,
                name: 'Pingpong',
                locale,
                api: { baseUrl: '/admin/v1' },
                auth: { mode: 'panneau' },
                user: { id: 'admin' },
            });
            expect(definition.pages?.home).toMatchObject({ component: 'pingpong-overview' });
            const projects = definition.resources.find((resource) => resource.id === 'projects');
            expect(projects?.actions?.map((action) => action.id)).toEqual([
                'new',
                'disable',
                'enable',
                'delete',
            ]);
        }
        await expect(setup({}, null).adapter.getDefinition()).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
    });

    it('has no queued action runs, and no search', async () => {
        const { adapter } = setup();
        await expect(adapter.listActionRuns()).resolves.toEqual([]);
        await expect(adapter.getActionRun('run_1')).rejects.toBeInstanceOf(NotFoundError);
        await expect(adapter.search('app')).resolves.toEqual({ data: [] });
        await expect(adapter.list('keys')).rejects.toBeInstanceOf(NotFoundError);
        await expect(adapter.getWidgetData('usage')).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe('projects', () => {
    it('lists them as items, paged, sorted and filtered here', async () => {
        const { adapter } = setup();
        const page = await adapter.list('projects', { sort: ['-name'], perPage: 1 });
        expect(page.meta).toMatchObject({ total: 2, lastPage: 2 });
        expect(page.data[0]).toMatchObject({
            id: 'other',
            name: 'Other',
            status: 'active',
            key: project().key,
            origins: ['https://example.com'],
            maxConnections: 500,
            maxMessagesPerSecond: null,
            connections: 12,
            peakConnections: 40,
            messages: 1200,
            abilities: { update: true, disable: true, enable: false, delete: true },
        });
        const disabled = await adapter.list('projects', { filter: { status: 'disabled' } });
        expect(disabled.data).toEqual([]);
    });

    it('creates one, and gives its secret with its item, once', async () => {
        const { adapter, requests } = setup({}, ADMIN_TOKEN, {
            'POST /admin/v1/projects': () =>
                json(
                    { project: project({ id: 'new-app', name: 'New app' }), secret: SECRET },
                    { status: 201, schema: 'AdminProjectCreated' },
                ),
        });
        const item = await adapter.create('projects', {
            id: ' new-app ',
            name: 'New app',
            origins: ['https://example.com', ' ', 'https://example.com'],
            maxConnections: 100,
            maxMessageSize: null,
        });
        expect(item).toMatchObject({ id: 'new-app', secret: SECRET });
        expect(requests.at(-1)?.body).toEqual({
            id: 'new-app',
            name: 'New app',
            origins: ['https://example.com'],
            limits: { maxConnections: 100 },
        });
    });

    it('sends what the form changed: an empty limit goes back to the default', async () => {
        let patch: AdminProjectPatch | undefined;
        const { adapter } = setup({}, ADMIN_TOKEN, {
            'PATCH /admin/v1/projects/my-app': ({ body }) => {
                patch = body as AdminProjectPatch;
                return json(project({ ownLimits: {} }), { schema: 'AdminProject' });
            },
            'GET /admin/v1/projects/my-app': () => json(project(), { schema: 'AdminProject' }),
        });
        await adapter.update('projects', 'my-app', {
            name: ' Renamed ',
            origins: [],
            maxConnections: null,
            maxChannelsPerSocket: 5,
        });
        expect(patch).toEqual({
            name: 'Renamed',
            origins: [],
            limits: { maxConnections: null, maxChannelsPerSocket: 5 },
        });
        // Nothing to change: the admin API refuses an empty patch.
        patch = undefined;
        await expect(adapter.update('projects', 'my-app', {})).resolves.toMatchObject({
            id: 'my-app',
        });
        expect(patch).toBeUndefined();
    });

    it('disables, enables and deletes them, and counts what failed', async () => {
        const { adapter, requests } = setup({}, ADMIN_TOKEN, {
            'PATCH /admin/v1/projects/my-app': () =>
                json(project({ disabled: true }), { schema: 'AdminProject' }),
            'DELETE /admin/v1/projects/my-app': () => new Response(null, { status: 204 }),
        });
        const disabled = await adapter.runAction('projects', 'disable', {
            selection: { ids: ['my-app', 'gone'] },
        });
        expect(disabled.result).toMatchObject({
            summary: { succeeded: 1, failed: 1 },
            refresh: 'items',
        });
        expect(requests.find((request) => request.method === 'PATCH')?.body).toEqual({
            disabled: true,
        });
        const dryRun = await adapter.runAction('projects', 'delete', {
            selection: { ids: ['my-app'] },
            dryRun: true,
        });
        expect(dryRun.result).toMatchObject({ summary: { succeeded: 1 } });
        expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
        const deleted = await adapter.runAction('projects', 'delete', {
            selection: { ids: ['my-app'] },
        });
        expect(deleted.result).toMatchObject({ summary: { succeeded: 1, failed: 0 } });
        await expect(
            adapter.runAction('projects', 'archive', { selection: { ids: ['my-app'] } }),
        ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rotates a secret with a grace period, and gives the new one back', async () => {
        const expires = '2026-11-07T13:00:00.000Z';
        const { adapter, requests } = setup({}, ADMIN_TOKEN, {
            'POST /admin/v1/projects/my-app/rotate-secret': () =>
                json(
                    { secret: SECRET, previousSecretExpiresAt: expires },
                    { schema: 'AdminProjectSecret' },
                ),
        });
        const { result } = await adapter.runAction('projects', 'rotate-secret', {
            selection: { ids: ['my-app'] },
            values: { gracePeriod: 3600 },
        });
        expect(result).toMatchObject({ secret: SECRET, previousSecretExpiresAt: expires });
        expect(requests.at(-1)?.body).toEqual({ gracePeriod: 3600 });
    });
});

describe('widgets', () => {
    it('give the overview, a project and its channels', async () => {
        const status = {
            version: '0.2.0',
            startedAt: '2026-11-06T11:00:00.000Z',
            healthy: true,
            checks: [{ name: 'database', status: 'ok', detail: 'postgres' }],
            projects: 2,
            connections: 12,
            channels: 3,
        };
        const channels = {
            channels: [{ channel: 'comments.1', occupied: true, subscriptionCount: 4 }],
            total: 1,
        };
        const { adapter, requests } = setup({}, ADMIN_TOKEN, {
            'GET /admin/v1/status': () => json(status, { schema: 'ServerStatus' }),
            'GET /admin/v1/projects/my-app': () => json(project(), { schema: 'AdminProject' }),
            'GET /admin/v1/projects/my-app/channels': () =>
                json(channels, { schema: 'AdminChannelList' }),
        });
        await expect(adapter.getWidgetData('overview')).resolves.toMatchObject({
            status,
            projects: [{ id: 'my-app' }, { id: 'other' }],
        });
        await expect(adapter.getWidgetData('project?id=my-app')).resolves.toMatchObject({
            id: 'my-app',
        });
        await expect(
            adapter.getWidgetData('channels?project=my-app&prefix=comments.&limit=100'),
        ).resolves.toEqual(channels);
        expect(requests.at(-1)?.url.search).toBe('?prefix=comments.&limit=100');
        await adapter.getWidgetData('channels?project=my-app&prefix=');
        expect(requests.at(-1)?.url.search).toBe('');
    });
});

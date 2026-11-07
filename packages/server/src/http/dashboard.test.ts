import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../config.ts';
import { createTestDatabase } from '../database/testing.ts';
import { createPingpongServer } from '../server.ts';
import type { PingpongServer } from '../server.ts';
import { TEST_SECRET_KEY } from '../testing.ts';
import { DASHBOARD_CSP, REACT_ARIA_STYLE_HASH, findDashboard, loadDashboard } from './dashboard.ts';

const ADMIN_TOKEN = 'a'.repeat(32);
const INDEX =
    '<!doctype html><title>Pingpong</title><script type="module" src="/dashboard/assets/index-abc.js"></script>';

let root: string;
const servers: PingpongServer[] = [];

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pingpong-dashboard-'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), INDEX);
    await writeFile(join(root, 'assets', 'index-abc.js'), 'console.log("pingpong");');
    await writeFile(join(root, 'assets', 'index-abc.css'), 'body{margin:0}');
    await writeFile(join(root, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(join(root, 'notes.md'), 'Not served: an unknown type.');
});

afterAll(async () => {
    for (const server of servers) {
        await server.close();
        await server.database.close();
    }
    await rm(root, { recursive: true, force: true });
});

async function app(env: Record<string, string> = { PINGPONG_ADMIN_TOKEN: ADMIN_TOKEN }) {
    const config = loadConfig({
        PINGPONG_DATABASE_URL: 'sqlite::memory:',
        PINGPONG_SECRET_KEY: TEST_SECRET_KEY,
        ...env,
    });
    const server = await createPingpongServer(config, {
        database: await createTestDatabase(),
        logger: false,
        dashboard: await loadDashboard(root),
    });
    servers.push(server);
    return server.app;
}

describe('dashboard', () => {
    it('serves the page at /dashboard/, with a strict Content Security Policy', async () => {
        const server = await app();
        const redirect = await server.inject({ method: 'GET', url: '/dashboard' });
        expect(redirect.statusCode).toBe(308);
        expect(redirect.headers.location).toBe('/dashboard/');

        const page = await server.inject({ method: 'GET', url: '/dashboard/' });
        expect(page.statusCode).toBe(200);
        expect(page.body).toBe(INDEX);
        expect(page.headers).toMatchObject({
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-cache',
            'content-security-policy': DASHBOARD_CSP,
            'x-content-type-options': 'nosniff',
            'x-frame-options': 'DENY',
            'referrer-policy': 'no-referrer',
        });
        expect(DASHBOARD_CSP).toContain("default-src 'none'");
        expect(DASHBOARD_CSP).toContain("script-src 'self';");
        expect(DASHBOARD_CSP).toContain("connect-src 'self'");
        expect(DASHBOARD_CSP).not.toContain('unsafe-eval');
        expect(DASHBOARD_CSP).toContain("frame-ancestors 'none'");
    });

    it('serves the page for the app’s routes, which run in the browser', async () => {
        const server = await app();
        for (const url of [
            '/dashboard/resources/projects',
            '/dashboard/resources/projects/my-app/edit',
        ]) {
            const response = await server.inject({ method: 'GET', url });
            expect(response.statusCode, url).toBe(200);
            expect(response.body).toBe(INDEX);
        }
    });

    it('caches the assets for good, and answers 404 for a missing one', async () => {
        const server = await app();
        const script = await server.inject({
            method: 'GET',
            url: '/dashboard/assets/index-abc.js',
        });
        expect(script.statusCode).toBe(200);
        expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8');
        expect(script.headers['cache-control']).toBe('public, max-age=31536000, immutable');
        expect(script.headers['content-security-policy']).toBe(DASHBOARD_CSP);

        const again = await server.inject({
            method: 'GET',
            url: '/dashboard/assets/index-abc.js',
            headers: { 'if-none-match': String(script.headers.etag) },
        });
        expect(again.statusCode).toBe(304);

        const icon = await server.inject({ method: 'GET', url: '/dashboard/favicon.svg' });
        expect(icon.headers['content-type']).toBe('image/svg+xml');

        for (const url of [
            '/dashboard/assets/index-old.js',
            '/dashboard/notes.md',
            '/dashboard/../package.json',
            '/dashboard/%2e%2e/%2e%2e/package.json',
        ]) {
            const response = await server.inject({ method: 'GET', url });
            expect(response.body, url).not.toContain('"name"');
            expect(response.body, url).not.toBe('Not served: an unknown type.');
        }
        const missing = await server.inject({
            method: 'GET',
            url: '/dashboard/assets/index-old.js',
        });
        expect(missing.statusCode).toBe(404);
        expect(missing.headers['content-type']).toContain('application/problem+json');
    });

    it('allows the inline style of the installed React Aria, and no other', async () => {
        // The dashboard's React Aria, through the dashboard's own dependencies.
        const require = createRequire(import.meta.resolve('@pingpong-io/dashboard/package.json'));
        const source = await readFile(
            join(
                dirname(require.resolve('react-aria/package.json')),
                'dist/private/interactions/usePress.mjs',
            ),
            'utf8',
        );
        const template = /style\.textContent = `([\s\S]*?)`\.trim\(\)/.exec(source)?.[1];
        expect(template).toBeDefined();
        const css = (template ?? '')
            .replace(/\$\{[^}]+PRESSABLE_ATTRIBUTE\}/, 'data-react-aria-pressable')
            .trim();
        const hash = createHash('sha256').update(css).digest('base64');
        expect(REACT_ARIA_STYLE_HASH).toBe(`sha256-${hash}`);
        expect(DASHBOARD_CSP).not.toContain('unsafe-inline');
    });

    it('is not served without the admin token, or with PINGPONG_DASHBOARD=false', async () => {
        const envs: Record<string, string>[] = [
            {},
            { PINGPONG_ADMIN_TOKEN: ADMIN_TOKEN, PINGPONG_DASHBOARD: 'false' },
        ];
        for (const env of envs) {
            const server = await app(env);
            const response = await server.inject({ method: 'GET', url: '/dashboard/' });
            expect(response.statusCode).toBe(404);
        }
    });

    it('needs a built dashboard', async () => {
        const empty = await mkdtemp(join(tmpdir(), 'pingpong-dashboard-empty-'));
        await expect(loadDashboard(empty)).rejects.toThrow(/no index\.html/);
        await rm(empty, { recursive: true, force: true });
        // In this checkout, the dashboard is found built or not, without throwing.
        const found = await findDashboard();
        expect(found.files !== undefined || found.error instanceof Error).toBe(true);
    });
});

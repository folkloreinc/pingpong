import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validate } from '@pingpong-io/protocol';

import { loadConfig } from '../config.ts';
import type { Database } from '../database/connection.ts';
import { createTestDatabase } from '../database/testing.ts';
import { ConflictError, InvalidValueError, NotFoundError } from '../errors.ts';
import { ProjectCache } from './cache.ts';
import { Projects } from './projects.ts';

const defaults = loadConfig({ PINGPONG_DATABASE_URL: 'sqlite::memory:' }).defaultLimits;
const key = Buffer.alloc(32, 3);

describe('Projects', () => {
    let database: Database;
    let now: Date;
    let projects: Projects;

    beforeEach(async () => {
        database = await createTestDatabase();
        now = new Date('2026-11-06T12:00:00.000Z');
        projects = new Projects(database, key, defaults, () => now);
    });

    afterEach(async () => {
        await database.close();
    });

    it('creates a project with a public key and a secret, encrypted at rest', async () => {
        const { project, secret } = await projects.create('my-app', {
            name: 'My app',
            origins: ['https://example.com'],
        });
        expect(project).toMatchObject({
            id: 'my-app',
            name: 'My app',
            origins: ['https://example.com'],
            secrets: [secret],
            disabled: false,
            limits: defaults,
            ownLimits: {},
        });
        expect(validate('PublicKey', project.key).valid).toBe(true);
        expect(secret).toMatch(/^sk_/);
        const row = await database.kysely
            .selectFrom('projects')
            .selectAll()
            .executeTakeFirstOrThrow();
        expect(row.secret).not.toContain(secret);
        expect(await projects.findByKey(project.key)).toMatchObject({ id: 'my-app' });
    });

    it('refuses bad ids, origins and limits, and taken ids', async () => {
        await expect(projects.create('My App')).rejects.toThrow(InvalidValueError);
        await expect(
            projects.create('app', { origins: ['https://example.com/path'] }),
        ).rejects.toThrow(/Not an origin: https:\/\/example.com\/path/);
        await expect(projects.create('app', { limits: { maxConnections: 0 } })).rejects.toThrow(
            InvalidValueError,
        );
        await projects.create('app');
        await expect(projects.create('app')).rejects.toThrow(ConflictError);
        await expect(projects.get('other')).rejects.toThrow(NotFoundError);
    });

    it('updates names, origins, limits and the status', async () => {
        await projects.create('app', { limits: { maxConnections: 5 } });
        now = new Date('2026-11-06T13:00:00.000Z');
        const updated = await projects.update('app', {
            name: 'App',
            origins: ['https://*.example.com'],
            limits: { maxConnections: null, maxMessageSize: 2048 },
            disabled: true,
        });
        expect(updated).toMatchObject({
            name: 'App',
            origins: ['https://*.example.com'],
            ownLimits: { maxMessageSize: 2048 },
            limits: { ...defaults, maxMessageSize: 2048 },
            disabled: true,
            updatedAt: now,
        });
        expect((await projects.update('app', { disabled: false })).disabled).toBe(false);
    });

    it('keeps the previous secret valid for the grace period after a rotation', async () => {
        const { secret: first } = await projects.create('app');
        const { project, secret: second } = await projects.rotateSecret('app', 3600);
        expect(project.secrets).toEqual([second, first]);
        expect(project.previousSecretExpiresAt).toEqual(new Date('2026-11-06T13:00:00.000Z'));

        now = new Date('2026-11-06T13:00:00.001Z');
        expect((await projects.get('app')).secrets).toEqual([second]);

        const { project: again, secret: third } = await projects.rotateSecret('app', 0);
        expect(again.secrets).toEqual([third]);
    });

    it('lists and deletes projects', async () => {
        await projects.create('b');
        await projects.create('a');
        expect((await projects.list()).map((project) => project.id)).toEqual(['a', 'b']);
        await projects.delete('a');
        await expect(projects.delete('a')).rejects.toThrow(NotFoundError);
        expect((await projects.list()).map((project) => project.id)).toEqual(['b']);
    });
});

describe('ProjectCache', () => {
    let database: Database;

    beforeEach(async () => {
        database = await createTestDatabase();
    });

    afterEach(async () => {
        await database.close();
    });

    it('reads a project once per ttl, unless invalidated', async () => {
        const projects = new Projects(database, key, defaults);
        const cache = new ProjectCache(projects, 60_000);
        const { project } = await projects.create('app');
        expect(await cache.find('missing')).toBeUndefined();
        expect((await cache.findByKey(project.key))?.name).toBe('app');

        await projects.update('app', { name: 'Renamed' });
        expect((await cache.find('app'))?.name).toBe('Renamed');
        expect((await cache.findByKey(project.key))?.name).toBe('app');
        cache.invalidate(project);
        expect((await cache.findByKey(project.key))?.name).toBe('Renamed');
    });

    it('keeps a bounded number of entries, whatever ids and keys are tried', async () => {
        const projects = new Projects(database, key, defaults);
        const cache = new ProjectCache(projects, 60_000, { maxEntries: 5 });
        const { project } = await projects.create('app');
        for (let index = 0; index < 50; index += 1) {
            expect(await cache.find(`missing-${index}`)).toBeUndefined();
            expect(await cache.findByKey(`pk_missing${index}`)).toBeUndefined();
        }
        expect(cache.size).toBeLessThanOrEqual(10);
        expect((await cache.find('app'))?.key).toBe(project.key);
        expect((await cache.findByKey(project.key))?.id).toBe('app');
    });
});

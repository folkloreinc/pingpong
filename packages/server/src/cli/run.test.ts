import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../database/connection.ts';
import { createTestDatabase, dropTables, testDatabaseUrl } from '../database/testing.ts';
import { TEST_SECRET_KEY } from '../testing.ts';
import { EXIT, runCli } from './run.ts';

describe('the pingpong CLI', () => {
    let directory: string;
    let env: Record<string, string>;

    beforeEach(async () => {
        directory = mkdtempSync(join(tmpdir(), 'pingpong-cli-'));
        // The CLI opens its own connection for each command: SQLite needs a file, not memory.
        const url = testDatabaseUrl().startsWith('sqlite')
            ? `sqlite://${join(directory, 'test.db')}`
            : testDatabaseUrl();
        if (!url.startsWith('sqlite')) {
            const database = createDatabase(url);
            await dropTables(database);
            await database.close();
        }
        env = { PINGPONG_DATABASE_URL: url, PINGPONG_SECRET_KEY: TEST_SECRET_KEY };
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    async function run(
        ...argv: string[]
    ): Promise<{ code: number; stdout: string; stderr: string }> {
        let stdout = '';
        let stderr = '';
        const code = await runCli(argv, {
            stdout: (text) => (stdout += text),
            stderr: (text) => (stderr += text),
            env,
            waitForStop: () => Promise.resolve(),
        });
        return { code, stdout, stderr };
    }

    it('shows its help', async () => {
        expect((await run()).stdout).toMatch(/pingpong projects create <id>/);
        expect((await run('nope')).code).toBe(EXIT.usage);
    });

    it('needs the migrations before managing projects', async () => {
        const pending = await run('projects', 'list');
        expect(pending.code).toBe(EXIT.unavailable);
        expect(pending.stderr).toMatch(/pingpong migrate/);
        expect((await run('migrate')).stdout).toBe('Ran 0001-projects\n');
        expect((await run('migrate')).stdout).toBe('The database is up to date.\n');
    });

    it('creates, shows, updates, rotates and deletes projects', async () => {
        await run('migrate');
        const created = await run(
            'projects',
            'create',
            'my-app',
            '--name',
            'My app',
            '--origin',
            'https://example.com',
            '--max-connections',
            '50',
        );
        expect(created.code).toBe(EXIT.ok);
        expect(created.stdout).toMatch(/key: +pk_/);
        expect(created.stdout).toMatch(/secret: +sk_[A-Za-z0-9_-]+/);
        expect(created.stdout).toMatch(/max-connections: 50\n/);
        expect(created.stdout).toMatch(/max-message-size: 10240 \(default\)/);

        expect((await run('projects', 'list')).stdout).toMatch(
            /^my-app\tpk_\S+\tenabled\tMy app\n$/,
        );
        const shown = JSON.parse(
            (await run('projects', 'show', 'my-app', '--json')).stdout,
        ) as Record<string, unknown>;
        expect(shown).toMatchObject({ id: 'my-app', origins: ['https://example.com'] });
        expect(shown).not.toHaveProperty('secrets');

        const updated = await run(
            'projects',
            'update',
            'my-app',
            '--no-origins',
            '--max-connections',
            'default',
            '--disable',
        );
        expect(updated.stdout).toMatch(/status: +disabled/);
        expect(updated.stdout).toMatch(/max-connections: 10000 \(default\)/);

        const rotated = await run('projects', 'rotate-secret', 'my-app', '--grace-period', '60');
        expect(rotated.stdout).toMatch(/The previous secret works until/);

        expect((await run('projects', 'delete', 'my-app')).code).toBe(EXIT.usage);
        expect((await run('projects', 'delete', 'my-app', '--yes')).stdout).toBe(
            'Deleted my-app.\n',
        );
        expect((await run('projects', 'show', 'my-app')).stderr).toBe('No project "my-app".\n');
    });

    it('explains invalid input', async () => {
        await run('migrate');
        expect((await run('projects', 'create', 'My App')).stderr).toMatch(
            /not a valid project id/,
        );
        expect((await run('projects', 'create', 'app', '--max-connections', 'many')).code).toBe(
            EXIT.usage,
        );
        expect((await run('projects', 'create', 'app', '--nope')).code).toBe(EXIT.usage);
        env = { PINGPONG_DATABASE_URL: env['PINGPONG_DATABASE_URL'] ?? '' };
        const missingKey = await run('projects', 'create', 'app');
        expect(missingKey.code).toBe(EXIT.config);
        expect(missingKey.stderr).toMatch(/PINGPONG_SECRET_KEY/);
    });

    it('checks the installation', async () => {
        const before = await run('doctor');
        expect(before.code).toBe(EXIT.failure);
        expect(before.stdout).toMatch(/FAIL {2}migrations: 1 pending/);
        await run('migrate');
        await run('projects', 'create', 'app');
        const after = await run('doctor');
        expect(after.stdout).toMatch(/ok {4}secret key \(1 project\(s\)\)/);
        expect(after.code).toBe(EXIT.ok);
        env['PINGPONG_SECRET_KEY'] = '1'.repeat(64);
        expect((await run('doctor')).stdout).toMatch(
            /FAIL {2}secret key: it can't decrypt the secrets of app/,
        );
    });
});

describe('createTestDatabase', () => {
    it('gives an empty, migrated database', async () => {
        const database = await createTestDatabase();
        expect(await database.kysely.selectFrom('projects').selectAll().execute()).toEqual([]);
        await database.close();
    });
});

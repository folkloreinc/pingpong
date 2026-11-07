import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startTestServer } from '../testing.ts';
import type { TestProject, TestServer } from '../testing.ts';
import { UsageRecorder, usageReport, utcDay } from './usage.ts';

function connected(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
    });
}

const message = { channels: ['a', 'bc'], event: 'e', data: { id: 1 } };
const size = Buffer.byteLength(JSON.stringify({ channel: '', event: 'e', data: { id: 1 } }));

describe('usage', () => {
    let server: TestServer;
    let app: TestProject;
    let clock: Date;

    const recorder = (retentionDays = 400) =>
        new UsageRecorder(server.database, server.server.realtime, {
            flushInterval: 60_000,
            retentionDays,
            now: () => clock,
        });
    const report = (days = 30, projectId?: string) =>
        usageReport(server.database, { days, projectId, now: clock });
    const later = (milliseconds: number) => {
        clock = new Date(clock.getTime() + milliseconds);
    };

    beforeEach(async () => {
        server = await startTestServer();
        app = await server.createProject('app', { limits: { maxMessagesPerSecond: 2 } });
        clock = new Date('2026-11-07T12:00:00Z');
    });

    afterEach(async () => {
        await server.close();
    });

    it('adds what was counted since the last flush to the row of the day', async () => {
        const usage = recorder();
        await connected(server.connect(app));
        await connected(server.connect(app));
        const refused = server.connect('app', 'pk_wrong', { reconnection: false });
        await expect(connected(refused)).rejects.toThrow('invalid_key');
        expect((await server.request(app, 'POST', '/v1/messages', message)).status).toBe(202);
        expect((await server.request(app, 'POST', '/v1/messages', message)).status).toBe(429);

        later(90_000);
        await usage.flush();
        expect((await report()).lines).toEqual([
            {
                project: 'app',
                day: '2026-11-07',
                messages: 2,
                bytes: 2 * size + 3,
                // Two sockets for a minute and a half
                connectionMinutes: 3,
                peakConnections: 2,
                connectionsRefused: 1,
                rateLimited: 1,
            },
        ]);

        // Only what grew since: nothing published, the sockets still connected.
        later(30_000);
        await usage.flush();
        const [line] = (await report()).lines;
        expect(line).toMatchObject({ messages: 2, connectionMinutes: 4, rateLimited: 1 });
    });

    it('lets several servers add to the same row', async () => {
        const first = recorder();
        const second = recorder();
        await connected(server.connect(app));
        await server.request(app, 'POST', '/v1/messages', message);
        await first.flush();
        // The second server counted the same message: both add theirs.
        await second.flush();
        const [line] = (await report()).lines;
        expect(line).toMatchObject({ messages: 4, peakConnections: 1 });
    });

    it('writes each UTC day in its own row', async () => {
        const usage = recorder();
        clock = new Date('2026-11-07T23:59:30Z');
        await server.request(app, 'POST', '/v1/messages', { channels: ['a'], event: 'e' });
        await usage.flush();
        later(60_000);
        await server.request(app, 'POST', '/v1/messages', { channels: ['a'], event: 'e' });
        await usage.flush();
        const { since, until, lines } = await report(2);
        expect({ since, until }).toEqual({ since: '2026-11-07', until: '2026-11-08' });
        expect(lines.map(({ day, messages }) => [day, messages])).toEqual([
            ['2026-11-07', 1],
            ['2026-11-08', 1],
        ]);
        expect((await report(1)).lines.map(({ day }) => day)).toEqual(['2026-11-08']);
    });

    it('keeps the usage of a deleted project, and filters by project', async () => {
        const other = await server.createProject('other');
        const usage = recorder();
        await server.request(app, 'POST', '/v1/messages', { channels: ['a'], event: 'e' });
        await server.request(other, 'POST', '/v1/messages', { channels: ['a'], event: 'e' });
        await usage.flush();
        await server.server.projects.delete('other');
        expect((await report()).lines.map(({ project }) => project)).toEqual(['app', 'other']);
        expect((await report(30, 'other')).lines).toHaveLength(1);
    });

    it('deletes the days past the retention', async () => {
        const usage = recorder(30);
        for (const day of ['2026-10-08', '2026-10-09', '2026-11-07']) {
            await server.database.kysely
                .insertInto('usage')
                .values({
                    project_id: 'app',
                    day,
                    messages: 1,
                    bytes: 1,
                    connection_minutes: 0,
                    peak_connections: 0,
                    connections_refused: 0,
                    rate_limited: 0,
                })
                .execute();
        }
        await usage.purge();
        expect((await report(400)).lines.map(({ day }) => day)).toEqual([
            '2026-10-09',
            '2026-11-07',
        ]);
    });

    it('flushes when the server stops', async () => {
        await server.request(app, 'POST', '/v1/messages', { channels: ['a'], event: 'e' });
        await server.server.usage.close();
        const { lines } = await usageReport(server.database, { days: 1 });
        expect(lines).toMatchObject([{ project: 'app', day: utcDay(new Date()), messages: 1 }]);
    });
});

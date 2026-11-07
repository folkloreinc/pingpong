import { describe, expect, it } from 'vitest';

import type { UsageLine } from '@pingpong-io/protocol';

import { daysBack, periodDays, recentMonths, toCsv, totalsByProject } from './usage.ts';

const now = new Date('2026-11-07T15:00:00Z');

function line(project: string, day: string, extra: Partial<UsageLine> = {}): UsageLine {
    return {
        project,
        day,
        messages: 10,
        bytes: 100,
        connectionMinutes: 60,
        peakConnections: 2,
        connectionsRefused: 0,
        rateLimited: 0,
        ...extra,
    };
}

describe('periods', () => {
    it('cover the last days, or a calendar month up to today', () => {
        expect(periodDays('last7', now)).toHaveLength(7);
        expect(periodDays('last7', now).at(-1)).toBe('2026-11-07');
        expect(periodDays('last30', now)[0]).toBe('2026-10-09');
        expect(periodDays('2026-11', now)).toHaveLength(7);
        expect(periodDays('2026-10', now)).toHaveLength(31);
        expect(recentMonths(now)).toEqual(['2026-11', '2026-10', '2026-09']);
    });

    it('ask the admin API for enough days', () => {
        expect(daysBack(periodDays('last30', now), now)).toBe(30);
        expect(daysBack(periodDays('2026-09', now), now)).toBe(68);
        expect(daysBack([], now)).toBe(1);
    });
});

describe('totalsByProject', () => {
    it('adds the days of the period, keeps the highest peak, and sorts by a measure', () => {
        const lines = [
            line('a', '2026-11-06', { messages: 5, peakConnections: 9 }),
            line('a', '2026-11-07', { messages: 5 }),
            line('b', '2026-11-07', { messages: 50, connectionMinutes: 10 }),
            line('a', '2026-10-01', { messages: 1000 }),
        ];
        const days = periodDays('last7', now);
        expect(totalsByProject(lines, days).map(({ project }) => project)).toEqual(['a', 'b']);
        expect(totalsByProject(lines, days, 'messages')[0]).toMatchObject({
            project: 'b',
            messages: 50,
        });
        expect(totalsByProject(lines, days).find(({ project }) => project === 'a')).toMatchObject({
            messages: 10,
            connectionMinutes: 120,
            peakConnections: 9,
        });
    });
});

describe('toCsv', () => {
    it('has a line per project and day of the period', () => {
        const csv = toCsv(
            [line('b', '2026-11-07'), line('a', '2026-11-07'), line('a', '2026-10-01')],
            periodDays('last7', now),
        );
        expect(csv.split('\n')).toEqual([
            'day,project,messages,bytes,connectionMinutes,peakConnections,connectionsRefused,rateLimited',
            '2026-11-07,a,10,100,60,2,0,0',
            '2026-11-07,b,10,100,60,2,0,0',
            '',
        ]);
    });
});

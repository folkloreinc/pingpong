import type { UsageLine } from '@pingpong-io/protocol';

/** A period of the usage page: the last 7 or 30 days, or a calendar month (`2026-10`). */
export type Period = 'last7' | 'last30' | `${number}-${number}`;

/** What the chart and the shares count. */
export type Measure = 'messages' | 'connectionMinutes';

const DAY = 24 * 60 * 60 * 1000;

function today(now: Date): number {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** The current month and the two before it, newest first. */
export function recentMonths(now: Date): Period[] {
    return [0, 1, 2].map((back) => {
        const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
        return date.toISOString().slice(0, 7) as Period;
    });
}

/** The UTC days of a period, oldest first, as `YYYY-MM-DD`. */
export function periodDays(period: Period, now: Date): string[] {
    const end = today(now);
    let start: number;
    let last = end;
    if (period === 'last7' || period === 'last30') {
        start = end - (period === 'last7' ? 6 : 29) * DAY;
    } else {
        const [year, month] = period.split('-').map(Number) as [number, number];
        start = Date.UTC(year, month - 1, 1);
        last = Math.min(Date.UTC(year, month, 1) - DAY, end);
    }
    const days: string[] = [];
    for (let time = start; time <= last; time += DAY) {
        days.push(new Date(time).toISOString().slice(0, 10));
    }
    return days;
}

/** How many days back `GET /admin/v1/usage` must go to cover a period. */
export function daysBack(days: readonly string[], now: Date): number {
    const first = days[0];
    return first === undefined
        ? 1
        : Math.max(1, Math.round((today(now) - Date.parse(first)) / DAY) + 1);
}

export interface ProjectUsage {
    project: string;
    messages: number;
    bytes: number;
    connectionMinutes: number;
    peakConnections: number;
    connectionsRefused: number;
    rateLimited: number;
}

/** The usage of each project over the days of a period, the largest of a measure first. */
export function totalsByProject(
    lines: readonly UsageLine[],
    days: readonly string[],
    measure: Measure = 'connectionMinutes',
): ProjectUsage[] {
    const inPeriod = new Set(days);
    const totals = new Map<string, ProjectUsage>();
    for (const line of lines) {
        if (!inPeriod.has(line.day)) {
            continue;
        }
        const total = totals.get(line.project) ?? {
            project: line.project,
            messages: 0,
            bytes: 0,
            connectionMinutes: 0,
            peakConnections: 0,
            connectionsRefused: 0,
            rateLimited: 0,
        };
        total.messages += line.messages;
        total.bytes += line.bytes;
        total.connectionMinutes += line.connectionMinutes;
        total.peakConnections = Math.max(total.peakConnections, line.peakConnections);
        total.connectionsRefused += line.connectionsRefused;
        total.rateLimited += line.rateLimited;
        totals.set(line.project, total);
    }
    return [...totals.values()].sort(
        (a, b) => b[measure] - a[measure] || a.project.localeCompare(b.project),
    );
}

const COLUMNS = [
    'messages',
    'bytes',
    'connectionMinutes',
    'peakConnections',
    'connectionsRefused',
    'rateLimited',
] as const;

/** The usage lines of a period as CSV, one line per project and day. */
export function toCsv(lines: readonly UsageLine[], days: readonly string[]): string {
    const inPeriod = new Set(days);
    const rows = lines
        .filter((line) => inPeriod.has(line.day))
        .sort((a, b) => a.day.localeCompare(b.day) || a.project.localeCompare(b.project))
        .map((line) =>
            [line.day, line.project, ...COLUMNS.map((column) => line[column])].join(','),
        );
    return `${[['day', 'project', ...COLUMNS].join(','), ...rows].join('\n')}\n`;
}

import { useDataAdapter } from '@panneau/data/query';
import { Alert, Button, Card, NumberInput, Select, Skeleton, Text, chartColors } from '@panneau/ui';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';

import styles from '../components/components.module.css';
import { formatBytes } from '../format.ts';
import type { UsageData } from '../widgets.ts';
import { PageLayout } from './PageLayout.tsx';
import {
    type Measure,
    type Period,
    daysBack,
    periodDays,
    recentMonths,
    toCsv,
    totalsByProject,
} from './usage.ts';

const COST_KEY = 'pingpong.serverCost';

function readCost(): number | null {
    try {
        const value = Number(localStorage.getItem(COST_KEY));
        return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
        return null;
    }
}

function writeCost(cost: number | null) {
    try {
        if (cost === null) {
            localStorage.removeItem(COST_KEY);
        } else {
            localStorage.setItem(COST_KEY, String(cost));
        }
    } catch {
        // A convenience only
    }
}

/**
 * Usage per project (decision 0010): messages or connection time per day and over a period, and
 * each project's share of the server's monthly cost, by connection time, which the operator types.
 */
export function UsagePage() {
    const intl = useIntl();
    const adapter = useDataAdapter();
    const [now] = useState(() => new Date());
    const [period, setPeriod] = useState<Period>('last30');
    const [measure, setMeasure] = useState<Measure>('connectionMinutes');
    const [cost, setCost] = useState<number | null>(readCost);
    const days = useMemo(() => periodDays(period, now), [period, now]);
    const back = daysBack(days, now);
    const usage = useQuery({
        queryKey: ['pingpong', 'usage', back],
        queryFn: ({ signal }) =>
            adapter.getWidgetData(`usage?days=${back}`, { signal }) as Promise<UsageData>,
    });
    const m = (id: string, values?: Record<string, string | number>) =>
        intl.formatMessage({ id }, values);
    const hours = (minutes: number) =>
        intl.formatNumber(minutes / 60, { style: 'unit', unit: 'hour', maximumFractionDigits: 1 });
    const value = (amount: number) =>
        measure === 'messages' ? intl.formatNumber(amount) : hours(amount);

    const data = usage.data;
    const lines = data?.report.lines ?? [];
    const totals = totalsByProject(lines, days, measure);
    const names = new Map(data?.projects.map((project) => [project.id, project.name]));
    const color = new Map(
        totals.map((total, index) => [total.project, chartColors.categorical(index)]),
    );
    const sum = (key: Exclude<keyof (typeof totals)[number], 'project'>) =>
        totals.reduce((total, project) => total + project[key], 0);
    const allMinutes = sum('connectionMinutes');
    const allMessages = sum('messages');
    const perDay = days.map((day) => {
        const ofDay = lines.filter((line) => line.day === day);
        return {
            day,
            total: ofDay.reduce((total, line) => total + line[measure], 0),
            segments: totals.map((total) => ({
                project: total.project,
                amount: ofDay
                    .filter((line) => line.project === total.project)
                    .reduce((amount, line) => amount + line[measure], 0),
            })),
        };
    });
    const peak = Math.max(1, ...perDay.map((entry) => entry.total));
    const formatDay = (day: string) =>
        intl.formatDate(`${day}T12:00:00Z`, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const share = (part: number, whole: number) =>
        intl.formatNumber(whole > 0 ? part / whole : 0, {
            style: 'percent',
            maximumFractionDigits: 1,
        });
    const money = (amount: number) =>
        intl.formatNumber(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const csvUrl = useMemo(
        () =>
            data !== undefined
                ? URL.createObjectURL(
                      new Blob([toCsv(data.report.lines, days)], { type: 'text/csv' }),
                  )
                : null,
        [data, days],
    );

    const periods: { value: Period; label: string }[] = [
        { value: 'last7', label: m('usage.period.last7') },
        { value: 'last30', label: m('usage.period.last30') },
        ...recentMonths(now).map((month) => ({
            value: month,
            label: intl.formatDate(`${month}-15T12:00:00Z`, {
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
            }),
        })),
    ];

    return (
        <PageLayout
            title={m('usage.title')}
            intro={m('usage.intro')}
            actions={
                csvUrl !== null ? (
                    <a href={csvUrl} download={`pingpong-usage-${period}.csv`}>
                        <Button icon={Download} excludeFromTabOrder>
                            {m('usage.export')}
                        </Button>
                    </a>
                ) : undefined
            }
        >
            <div className={styles.toolbar}>
                <Select
                    label={m('usage.period')}
                    options={periods}
                    value={period}
                    onChange={(selected) => setPeriod((selected ?? 'last30') as Period)}
                />
                <Select
                    label={m('usage.measure')}
                    options={[
                        { value: 'connectionMinutes', label: m('usage.measure.connectionMinutes') },
                        { value: 'messages', label: m('usage.measure.messages') },
                    ]}
                    value={measure}
                    onChange={(selected) =>
                        setMeasure((selected ?? 'connectionMinutes') as Measure)
                    }
                />
                <NumberInput
                    label={m('usage.cost')}
                    description={m('usage.costHelp')}
                    value={cost}
                    minValue={0}
                    onChange={(amount) => {
                        setCost(amount);
                        writeCost(amount);
                    }}
                />
            </div>

            {usage.isError ? (
                <Alert tone="danger">
                    <p>{m('usage.loadError', { message: usage.error.message })}</p>
                    <Button size="sm" onPress={() => void usage.refetch()}>
                        {m('common.retry')}
                    </Button>
                </Alert>
            ) : null}

            <Card title={m(`usage.perDay.${measure}`)} headingLevel={2}>
                {data === undefined ? (
                    <Skeleton height="12rem" />
                ) : (
                    <figure className={styles.figure}>
                        <ul className={styles.legend}>
                            {totals.map((total) => (
                                <li key={total.project}>
                                    <span
                                        className={styles.swatch}
                                        style={{ background: color.get(total.project) }}
                                        aria-hidden="true"
                                    />
                                    {names.get(total.project) ?? total.project}
                                </li>
                            ))}
                        </ul>
                        <div
                            className={styles.chart}
                            role="img"
                            aria-label={m(`usage.perDay.${measure}`)}
                        >
                            {perDay.map((entry) => (
                                <div
                                    key={entry.day}
                                    className={styles.bar}
                                    title={`${formatDay(entry.day)} · ${value(entry.total)}`}
                                >
                                    {entry.segments.map((segment) =>
                                        segment.amount > 0 ? (
                                            <div
                                                key={segment.project}
                                                className={styles.segment}
                                                style={{
                                                    height: `${(segment.amount / peak) * 100}%`,
                                                    background: color.get(segment.project),
                                                }}
                                            />
                                        ) : null,
                                    )}
                                </div>
                            ))}
                        </div>
                        <figcaption className={styles.axis}>
                            <span>{days[0] !== undefined ? formatDay(days[0]) : ''}</span>
                            <span>
                                {days.at(-1) !== undefined ? formatDay(days.at(-1) ?? '') : ''}
                            </span>
                        </figcaption>
                    </figure>
                )}
            </Card>

            <Card title={m('usage.perProject')} headingLevel={2}>
                {data === undefined ? (
                    <Skeleton height="8rem" />
                ) : totals.length === 0 ? (
                    <Text as="p" muted>
                        {m('usage.empty')}
                    </Text>
                ) : (
                    <div className={styles.tableBox}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th scope="col">{m('usage.columns.project')}</th>
                                    {[
                                        'messages',
                                        'bytes',
                                        'connectionTime',
                                        'peak',
                                        'refused',
                                        'rateLimited',
                                        'shareOfMessages',
                                        'shareOfTime',
                                        'cost',
                                    ].map((column) => (
                                        <th key={column} scope="col" className={styles.end}>
                                            {m(`usage.columns.${column}`)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {totals.map((total) => (
                                    <tr key={total.project}>
                                        <th scope="row">
                                            <span
                                                className={styles.swatch}
                                                style={{ background: color.get(total.project) }}
                                                aria-hidden="true"
                                            />
                                            {names.get(total.project) ?? total.project}
                                        </th>
                                        <td className={styles.end}>
                                            {intl.formatNumber(total.messages)}
                                        </td>
                                        <td className={styles.end}>
                                            {formatBytes(intl, total.bytes)}
                                        </td>
                                        <td className={styles.end}>
                                            {hours(total.connectionMinutes)}
                                        </td>
                                        <td className={styles.end}>
                                            {intl.formatNumber(total.peakConnections)}
                                        </td>
                                        <td className={styles.end}>
                                            {intl.formatNumber(total.connectionsRefused)}
                                        </td>
                                        <td className={styles.end}>
                                            {intl.formatNumber(total.rateLimited)}
                                        </td>
                                        <td className={styles.end}>
                                            {share(total.messages, allMessages)}
                                        </td>
                                        <td className={styles.end}>
                                            {share(total.connectionMinutes, allMinutes)}
                                        </td>
                                        <td className={styles.end}>
                                            {cost !== null && allMinutes > 0
                                                ? money(
                                                      (cost * total.connectionMinutes) / allMinutes,
                                                  )
                                                : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <th scope="row">{m('usage.total')}</th>
                                    <td className={styles.end}>{intl.formatNumber(allMessages)}</td>
                                    <td className={styles.end}>
                                        {formatBytes(intl, sum('bytes'))}
                                    </td>
                                    <td className={styles.end}>{hours(allMinutes)}</td>
                                    <td className={styles.end}>—</td>
                                    <td className={styles.end}>
                                        {intl.formatNumber(sum('connectionsRefused'))}
                                    </td>
                                    <td className={styles.end}>
                                        {intl.formatNumber(sum('rateLimited'))}
                                    </td>
                                    <td className={styles.end}>
                                        {share(allMessages, allMessages)}
                                    </td>
                                    <td className={styles.end}>{share(allMinutes, allMinutes)}</td>
                                    <td className={styles.end}>
                                        {cost !== null ? money(cost) : '—'}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
                <Text as="p" size="sm" muted>
                    {m('usage.note')}
                </Text>
            </Card>
        </PageLayout>
    );
}

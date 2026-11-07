import { useDataAdapter } from '@panneau/data/query';
import { Alert, Badge, Button, Grid, Skeleton, Stat, Text } from '@panneau/ui';
import { useQuery } from '@tanstack/react-query';
import { useIntl } from 'react-intl';

import styles from '../components/components.module.css';
import { BASE_PATH } from '../definition.ts';
import { formatAgo } from '../format.ts';
import { TONES } from '../tones.ts';
import type { OverviewData } from '../widgets.ts';
import { PageLayout } from './PageLayout.tsx';

/**
 * The overview, the dashboard's home: the server's checks, and what it sees now of every project.
 * It refreshes itself every 10 seconds.
 */
export function OverviewPage() {
    const intl = useIntl();
    const adapter = useDataAdapter();
    const overview = useQuery({
        queryKey: ['pingpong', 'overview'],
        queryFn: ({ signal }) =>
            adapter.getWidgetData('overview', { signal }) as Promise<OverviewData>,
        refetchInterval: 10_000,
    });
    const m = (id: string, values?: Record<string, string | number>) =>
        intl.formatMessage({ id }, values);
    const data = overview.data;

    if (data === undefined) {
        return (
            <PageLayout title={m('overview.title')}>
                {overview.isError ? (
                    <Alert tone="danger">
                        <p>{m('overview.loadError', { message: overview.error.message })}</p>
                        <Button size="sm" onPress={() => void overview.refetch()}>
                            {m('common.retry')}
                        </Button>
                    </Alert>
                ) : (
                    <Grid minItemWidth="12rem" gap={4}>
                        {[0, 1, 2, 3].map((index) => (
                            <Skeleton key={index} height="6rem" />
                        ))}
                    </Grid>
                )}
            </PageLayout>
        );
    }

    const { status, projects } = data;
    const failed = status.checks.filter((check) => check.status === 'failed');
    const checkName = (name: string) =>
        ['database', 'migrations', 'secretKey', 'redis'].includes(name)
            ? m(`overview.check.${name}`)
            : name;
    const messages = projects.reduce((total, project) => total + project.stats.messages, 0);
    const sorted = [...projects].sort(
        (a, b) => b.stats.connections - a.stats.connections || a.name.localeCompare(b.name),
    );

    return (
        <PageLayout
            title={m('overview.title')}
            intro={m('overview.intro', {
                version: status.version,
                started: formatAgo(intl, status.startedAt),
            })}
        >
            {failed.length > 0 ? (
                <Alert tone="danger">
                    {m('overview.unhealthy', {
                        checks: failed.map((check) => checkName(check.name)).join(', '),
                    })}
                </Alert>
            ) : (
                <Alert tone="success">{m('overview.healthy')}</Alert>
            )}
            <Grid minItemWidth="12rem" gap={4}>
                <Stat
                    label={m('overview.projects')}
                    value={status.projects}
                    help={m('overview.projectsHelp', {
                        disabled: projects.filter((project) => project.disabled).length,
                    })}
                    href={`${BASE_PATH}/resources/projects`}
                />
                <Stat
                    label={m('overview.connections')}
                    value={status.connections}
                    help={m('overview.connectionsHelp')}
                />
                <Stat
                    label={m('overview.channels')}
                    value={status.channels}
                    help={m('overview.channelsHelp')}
                />
                <Stat
                    label={m('overview.messages')}
                    value={messages}
                    help={m('overview.messagesHelp')}
                />
            </Grid>

            <Text weight="medium">{m('overview.checks')}</Text>
            <div className={styles.tableBox}>
                <table className={styles.table}>
                    <tbody>
                        {status.checks.map((check) => (
                            <tr key={check.name}>
                                <th scope="row">{checkName(check.name)}</th>
                                <td>
                                    <Badge tone={TONES[check.status] ?? 'neutral'}>
                                        {m(`overview.check.${check.status}`)}
                                    </Badge>
                                </td>
                                <td>{check.detail ?? ''}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Text weight="medium">{m('overview.byProject')}</Text>
            <div className={styles.tableBox}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th scope="col">{m('overview.project')}</th>
                            <th scope="col">{m('projects.fields.status')}</th>
                            <th scope="col" className={styles.end}>
                                {m('projects.fields.connections')}
                            </th>
                            <th scope="col" className={styles.end}>
                                {m('projects.fields.peakConnections')}
                            </th>
                            <th scope="col" className={styles.end}>
                                {m('live.channels')}
                            </th>
                            <th scope="col" className={styles.end}>
                                {m('projects.fields.messages')}
                            </th>
                            <th scope="col" className={styles.end}>
                                {m('projects.fields.rateLimited')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((project) => (
                            <tr key={project.id}>
                                <th scope="row">
                                    <a
                                        className={styles.link}
                                        href={`${BASE_PATH}/resources/projects/${encodeURIComponent(project.id)}/edit`}
                                    >
                                        {project.name}
                                    </a>
                                </th>
                                <td>
                                    <Badge tone={project.disabled ? 'neutral' : 'success'}>
                                        {m(project.disabled ? 'status.disabled' : 'status.active')}
                                    </Badge>
                                </td>
                                <td className={styles.end}>
                                    {intl.formatNumber(project.stats.connections)}
                                </td>
                                <td className={styles.end}>
                                    {intl.formatNumber(project.stats.peakConnections)}
                                </td>
                                <td className={styles.end}>
                                    {intl.formatNumber(project.stats.channels)}
                                </td>
                                <td className={styles.end}>
                                    {intl.formatNumber(project.stats.messages)}
                                </td>
                                <td className={styles.end}>
                                    {intl.formatNumber(project.stats.rateLimited)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </PageLayout>
    );
}

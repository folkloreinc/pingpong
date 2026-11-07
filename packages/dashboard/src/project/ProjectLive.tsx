import type { Form as FormStore } from '@panneau/core';
import { useDataAdapter } from '@panneau/data/query';
import { Alert, Grid, Stat, Text, TextInput } from '@panneau/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useIntl } from 'react-intl';

import type { AdminChannelList } from '@pingpong-io/protocol';

import styles from '../components/components.module.css';
import { formatBytes } from '../format.ts';
import { useLiveProject, useProjectId } from './useProject.ts';

const CHANNEL_LIMIT = 100;

/**
 * What the server sees of the project, live: its connections, channels, messages and refusals
 * since the server started, and its channels with their subscribers. Read again every 5 seconds.
 */
export function ProjectLive({ form }: { form: FormStore }) {
    const intl = useIntl();
    const id = useProjectId(form);
    const adapter = useDataAdapter();
    const project = useLiveProject(id);
    const [prefix, setPrefix] = useState('');
    const channels = useQuery({
        queryKey: ['pingpong', 'channels', id, prefix],
        queryFn: ({ signal }) =>
            adapter.getWidgetData(
                `channels?${new URLSearchParams({
                    project: id ?? '',
                    prefix,
                    limit: String(CHANNEL_LIMIT),
                })}`,
                { signal },
            ) as Promise<AdminChannelList>,
        enabled: id !== null,
        refetchInterval: 5_000,
        placeholderData: keepPreviousData,
    });
    if (id === null) {
        return null;
    }
    const m = (message: string, values?: Record<string, string | number>) =>
        intl.formatMessage({ id: message }, values);
    const error = project.error ?? channels.error;
    if (error !== null) {
        return <Alert tone="danger">{m('live.error', { message: error.message })}</Alert>;
    }
    const data = project.data;
    const stats = data?.stats;
    const refused = Object.entries(stats?.connectionsRefused ?? {}).filter(
        ([, count]) => count > 0,
    );
    return (
        <div className={styles.block}>
            <Grid minItemWidth="12rem" gap={4}>
                <Stat
                    label={m('live.connections')}
                    value={stats?.connections}
                    help={
                        data === undefined
                            ? undefined
                            : m('live.connectionsHelp', {
                                  peak: intl.formatNumber(data.stats.peakConnections),
                                  limit: intl.formatNumber(data.limits.maxConnections),
                              })
                    }
                />
                <Stat
                    label={m('live.channels')}
                    value={stats?.channels}
                    help={m('live.channelsHelp')}
                />
                <Stat
                    label={m('live.messages')}
                    value={stats?.messages}
                    help={
                        stats === undefined
                            ? undefined
                            : m('live.messagesHelp', { bytes: formatBytes(intl, stats.bytes) })
                    }
                />
                <Stat
                    label={m('live.rateLimited')}
                    value={stats?.rateLimited}
                    help={m('live.rateLimitedHelp')}
                    tone={(stats?.rateLimited ?? 0) > 0 ? 'warning' : undefined}
                />
            </Grid>
            {stats !== undefined ? (
                <Text as="p" size="sm" muted>
                    {refused.length > 0
                        ? m('live.refused', {
                              reasons: refused
                                  .map(
                                      ([reason, count]) =>
                                          `${m(`live.refusal.${reason}`)} (${intl.formatNumber(count)})`,
                                  )
                                  .join(', '),
                          })
                        : m('live.noRefused')}{' '}
                    {m('live.since', {
                        date: intl.formatDate(stats.since, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                        }),
                    })}
                </Text>
            ) : null}
            <Text weight="medium">{m('live.channelsTitle')}</Text>
            <div className={styles.row}>
                <TextInput
                    label={m('live.prefix')}
                    type="search"
                    value={prefix}
                    onChange={setPrefix}
                />
            </div>
            {channels.data !== undefined && channels.data.channels.length === 0 ? (
                <Text as="p" muted>
                    {m('live.noChannels')}
                </Text>
            ) : null}
            {channels.data !== undefined && channels.data.channels.length > 0 ? (
                <div className={styles.tableBox}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">{m('live.channel')}</th>
                                <th scope="col" className={styles.end}>
                                    {m('live.subscribers')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {channels.data.channels.map((channel) => (
                                <tr key={channel.channel}>
                                    <td>
                                        <code>{channel.channel}</code>
                                    </td>
                                    <td className={styles.end}>
                                        {intl.formatNumber(channel.subscriptionCount)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}
            {channels.data !== undefined && channels.data.total > channels.data.channels.length ? (
                <Text as="p" size="sm" muted>
                    {m('live.more', {
                        shown: intl.formatNumber(channels.data.channels.length),
                        total: intl.formatNumber(channels.data.total),
                    })}
                </Text>
            ) : null}
        </div>
    );
}

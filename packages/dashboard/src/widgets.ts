import type {
    AdminChannelList,
    AdminProject,
    AdminProjectList,
    ServerStatus,
} from '@pingpong-io/protocol';

import type { WidgetHandler } from './adapter/adapter.ts';

/** What the overview shows: the server's status, and its projects with their live stats. */
export interface OverviewData {
    status: ServerStatus;
    projects: AdminProject[];
}

const overview: WidgetHandler = async (_params, { client, signal }): Promise<OverviewData> => {
    const [status, { projects }] = await Promise.all([
        client.request<ServerStatus>('/status', { signal }),
        client.request<AdminProjectList>('/projects', { signal }),
    ]);
    return { status, projects };
};

/** A project, for the live state of its page. */
const project: WidgetHandler = (params, { client, signal }) =>
    client.request<AdminProject>(`/projects/${encodeURIComponent(params.get('id') ?? '')}`, {
        signal,
    });

/** The channels of a project, most subscribed first. */
const channels: WidgetHandler = (params, { client, signal }) =>
    client.request<AdminChannelList>(
        `/projects/${encodeURIComponent(params.get('project') ?? '')}/channels`,
        {
            query: {
                prefix: params.get('prefix') || undefined,
                limit: params.get('limit') ?? undefined,
            },
            signal,
        },
    );

export const widgets: Record<string, WidgetHandler> = { overview, project, channels };

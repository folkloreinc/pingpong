import type { Item } from '@panneau/protocol';

import type {
    AdminProject,
    AdminProjectCreate,
    AdminProjectCreated,
    AdminProjectList,
    AdminProjectPatch,
    AdminProjectSecret,
    LimitsPatch,
    UsageReport,
} from '@pingpong-io/protocol';

import type { ResourceHandler } from '../adapter/adapter.ts';
import { notFound } from '../adapter/client.ts';
import { LIMITS } from '../definition.ts';
import { forEachItem, pageOf, selectedIds } from './paging.ts';

/** A project as an item: its own limits are fields, empty for the server's defaults. */
export function projectItem(project: AdminProject, messages30?: number): Item {
    return {
        id: project.id,
        // The form starts over from the saved values when the project changes. Pingpong has no
        // concurrency check: the adapter sends no `If-Match`.
        version: project.updatedAt,
        abilities: {
            update: true,
            disable: !project.disabled,
            enable: project.disabled,
            // Panneau's built-in `delete`, which the definition gives a confirmation.
            delete: true,
        },
        name: project.name,
        status: project.disabled ? 'disabled' : 'active',
        key: project.key,
        origins: project.origins,
        ...Object.fromEntries(LIMITS.map((name) => [name, project.ownLimits[name] ?? null])),
        connections: project.stats.connections,
        peakConnections: project.stats.peakConnections,
        messages: project.stats.messages,
        rateLimited: project.stats.rateLimited,
        // Kept usage over the last 30 days, in the list only
        ...(messages30 === undefined ? {} : { messages30 }),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        // For the components of its page: the limits that apply, its secret's grace and its stats.
        project,
    };
}

/** The origins of a `tags` field: without blanks, once each. */
function originsOf(value: unknown): string[] {
    const origins = Array.isArray(value) ? value.map((entry) => String(entry).trim()) : [];
    return [...new Set(origins.filter((origin) => origin !== ''))];
}

/** The limits of the fields that are in `values`: empty goes back to the server's default. */
function limitsOf(values: Record<string, unknown>, { omitEmpty }: { omitEmpty: boolean }) {
    const limits: LimitsPatch = {};
    for (const name of LIMITS) {
        if (!(name in values)) {
            continue;
        }
        const value = values[name];
        const limit = typeof value === 'number' && Number.isFinite(value) ? value : null;
        if (!(omitEmpty && limit === null)) {
            limits[name] = limit;
        }
    }
    return Object.keys(limits).length > 0 ? limits : undefined;
}

/** The body that creates a project, from the values of the dialog. */
export function createRequest(values: Record<string, unknown>): AdminProjectCreate {
    const body: AdminProjectCreate = { id: String(values.id ?? '').trim() };
    if (typeof values.name === 'string' && values.name.trim() !== '') {
        body.name = values.name.trim();
    }
    const origins = originsOf(values.origins);
    if (origins.length > 0) {
        body.origins = origins;
    }
    const limits = limitsOf(values, { omitEmpty: true });
    if (limits !== undefined) {
        body.limits = limits;
    }
    return body;
}

const path = (project: string) => `/projects/${encodeURIComponent(project)}`;

export const projects: ResourceHandler = {
    async list(query, { client, signal }) {
        const [{ projects: list }, usage] = await Promise.all([
            client.request<AdminProjectList>('/projects', { signal }),
            client.request<UsageReport>('/usage', { query: { days: 30 }, signal }),
        ]);
        const messages = new Map<string, number>();
        for (const line of usage.lines) {
            messages.set(line.project, (messages.get(line.project) ?? 0) + line.messages);
        }
        return pageOf(
            list.map((project) => projectItem(project, messages.get(project.id) ?? 0)),
            query,
        );
    },

    async get(id, { client, signal }) {
        return projectItem(await client.request<AdminProject>(path(id), { signal }));
    },

    /** Creates a project. Its item has its `secret`, this once, for the dialog that shows it. */
    async create(values, { client, signal }) {
        const { project, secret } = await client.request<AdminProjectCreated>('/projects', {
            method: 'POST',
            body: createRequest(values),
            signal,
        });
        return { ...projectItem(project), secret };
    },

    async update(id, values, { client, signal }) {
        const body: AdminProjectPatch = {};
        if (typeof values.name === 'string') {
            body.name = values.name.trim();
        }
        if ('origins' in values) {
            body.origins = originsOf(values.origins);
        }
        const limits = limitsOf(values, { omitEmpty: false });
        if (limits !== undefined) {
            body.limits = limits;
        }
        if (Object.keys(body).length === 0) {
            // Nothing changed: the admin API refuses an empty patch.
            return projectItem(await client.request<AdminProject>(path(id), { signal }));
        }
        return projectItem(
            await client.request<AdminProject>(path(id), { method: 'PATCH', body, signal }),
        );
    },

    async delete(id, { client, signal }) {
        await client.request(path(id), { method: 'DELETE', signal });
    },

    async runAction(action, request, { client, signal }) {
        const ids = selectedIds(request);
        switch (action) {
            case 'disable':
            case 'enable':
                return {
                    result: await forEachItem(ids, (id) =>
                        client.request(path(id), {
                            method: 'PATCH',
                            body: { disabled: action === 'disable' },
                            signal,
                        }),
                    ),
                };
            case 'delete':
                if (request.dryRun === true) {
                    // Nothing is deleted on a dry run: every item would be.
                    return {
                        result: {
                            summary: { succeeded: ids.length, failed: 0, skipped: 0 },
                            results: [],
                            refresh: 'none',
                        },
                    };
                }
                return {
                    result: await forEachItem(ids, (id) =>
                        client.request(path(id), { method: 'DELETE', signal }),
                    ),
                };
            case 'rotate-secret': {
                const [id] = ids;
                if (id === undefined) {
                    throw notFound('No project to rotate the secret of.');
                }
                const gracePeriod = request.values?.gracePeriod;
                const rotation = await client.request<AdminProjectSecret>(
                    `${path(id)}/rotate-secret`,
                    {
                        method: 'POST',
                        body: typeof gracePeriod === 'number' ? { gracePeriod } : {},
                        signal,
                    },
                );
                // The new secret comes back with the result, for the dialog that asked for it.
                return { result: { refresh: 'none', ...rotation } };
            }
            default:
                throw notFound(`Projects have no action "${action}".`);
        }
    },
};

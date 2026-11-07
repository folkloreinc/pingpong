import type { FastifyInstance } from 'fastify';

import { toProblemErrors, validate } from '@pingpong-io/protocol';
import type {
    AdminChannelList,
    AdminProject,
    AdminProjectCreated,
    AdminProjectList,
    AdminProjectSecret,
    Channel,
    ServerStatus,
} from '@pingpong-io/protocol';

import type { CheckTargets } from '../checks.ts';
import { runChecks } from '../checks.ts';
import { safeEqual } from '../crypto.ts';
import type { Database } from '../database/connection.ts';
import type { ProjectCache } from '../projects/cache.ts';
import type { Project, Projects } from '../projects/projects.ts';
import type { Realtime } from '../realtime/realtime.ts';
import { MAX_USAGE_DAYS, usageReport } from '../usage/usage.ts';
import { VERSION } from '../version.ts';
import { HttpProblem } from './problem.ts';

export interface AdminOptions {
    /** `PINGPONG_ADMIN_TOKEN`. */
    adminToken: string;
    projects: Projects;
    cache: ProjectCache;
    realtime: Realtime;
    database: Database;
    /** What `GET /admin/v1/status` checks, as `pingpong doctor` does. */
    checks: CheckTargets;
    /** `PINGPONG_SECRET_GRACE_PERIOD`, in seconds. */
    secretGracePeriod: number;
}

const DEFAULT_CHANNEL_LIMIT = 100;
const MAX_CHANNEL_LIMIT = 500;

function unauthorized(): HttpProblem {
    return new HttpProblem(
        401,
        'Unauthorized',
        'Send the admin token: Authorization: Bearer <token>.',
        {
            headers: { 'www-authenticate': 'Bearer realm="pingpong-admin"' },
        },
    );
}

function invalid(errors: Parameters<typeof toProblemErrors>[0]): HttpProblem {
    return new HttpProblem(422, 'Unprocessable Content', 'The request is invalid.', {
        errors: toProblemErrors(errors),
    });
}

function projectIdOf(params: unknown): string {
    const id = (params as { project: string }).project;
    if (!validate('ProjectId', id).valid) {
        // An id that can't exist: there is no such project.
        throw new HttpProblem(404, 'Not Found', `No project "${id}".`);
    }
    return id;
}

/**
 * `/admin/v1`: the projects and the server's live state, for its operators and its dashboard
 * (decision 0009). Registered only when the server has an admin token.
 */
export async function adminRoutes(app: FastifyInstance, options: AdminOptions): Promise<void> {
    const { adminToken, projects, cache, realtime, database, checks, secretGracePeriod } = options;

    const toAdminProject = (project: Project): AdminProject => {
        const counters = realtime.stats.get(project.id);
        return {
            id: project.id,
            name: project.name,
            key: project.key,
            disabled: project.disabled,
            origins: project.origins,
            limits: project.limits,
            ownLimits: project.ownLimits,
            previousSecretExpiresAt: project.previousSecretExpiresAt?.toISOString() ?? null,
            createdAt: project.createdAt.toISOString(),
            updatedAt: project.updatedAt.toISOString(),
            stats: {
                since: realtime.stats.since.toISOString(),
                connections: realtime.connections(project.id),
                peakConnections: counters.peakConnections,
                connectionsRefused: counters.connectionsRefused,
                channels: realtime.channels(project.id).length,
                messages: counters.messages,
                bytes: counters.bytes,
                rateLimited: counters.rateLimited,
            },
        };
    };

    app.addHook('onRequest', async (request, reply) => {
        // Nothing here may be kept by a cache, a proxy's included: a response can have a secret.
        void reply.header('cache-control', 'no-store');
        const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.authorization ?? '');
        if (match?.[1] === undefined || !safeEqual(match[1], adminToken)) {
            throw unauthorized();
        }
    });

    app.get('/status', async (_request, reply) => {
        const results = await runChecks(checks);
        const projectIds = realtime.projectIds();
        const count = await database.kysely
            .selectFrom('projects')
            .select((eb) => eb.fn.countAll<number | string | bigint>().as('count'))
            .executeTakeFirstOrThrow();
        const body: ServerStatus = {
            version: VERSION,
            startedAt: realtime.stats.since.toISOString(),
            healthy: results.every((check) => check.status !== 'failed'),
            checks: results,
            projects: Number(count.count),
            connections: projectIds.reduce((total, id) => total + realtime.connections(id), 0),
            channels: projectIds.reduce((total, id) => total + realtime.channels(id).length, 0),
        };
        return reply.send(body);
    });

    app.get('/usage', async (request, reply) => {
        const query = request.query as Record<string, unknown>;
        const days =
            query['days'] === undefined || query['days'] === '' ? 30 : Number(query['days']);
        const errors: { pointer: string; message: string }[] = [];
        if (!Number.isInteger(days) || days < 1 || days > MAX_USAGE_DAYS) {
            errors.push({
                pointer: '/days',
                message: `must be an integer from 1 to ${MAX_USAGE_DAYS}`,
            });
        }
        const project = query['project'];
        if (project !== undefined && !validate('ProjectId', project).valid) {
            errors.push({ pointer: '/project', message: 'must be a project id' });
        }
        if (errors.length > 0) {
            throw invalid(errors);
        }
        // A deleted project's usage is kept (decision 0010): the id needn't exist.
        const body = await usageReport(database, {
            days,
            projectId: typeof project === 'string' ? project : undefined,
        });
        return reply.send(body);
    });

    app.get('/projects', async (_request, reply) => {
        const body: AdminProjectList = { projects: (await projects.list()).map(toAdminProject) };
        return reply.send(body);
    });

    app.post('/projects', async (request, reply) => {
        const result = validate('AdminProjectCreate', request.body);
        if (!result.valid) {
            throw invalid(result.errors);
        }
        const { id, ...input } = result.value;
        const { project, secret } = await projects.create(id, input);
        cache.invalidate(project);
        const body: AdminProjectCreated = { project: toAdminProject(project), secret };
        return reply.code(201).send(body);
    });

    app.get('/projects/:project', async (request, reply) => {
        const project = await projects.get(projectIdOf(request.params));
        return reply.send(toAdminProject(project));
    });

    app.patch('/projects/:project', async (request, reply) => {
        const id = projectIdOf(request.params);
        const result = validate('AdminProjectPatch', request.body);
        if (!result.valid) {
            throw invalid(result.errors);
        }
        const project = await projects.update(id, result.value);
        cache.invalidate(project);
        if (project.disabled) {
            realtime.disconnectProject(project.id);
        }
        return reply.send(toAdminProject(project));
    });

    app.delete('/projects/:project', async (request, reply) => {
        const project = await projects.get(projectIdOf(request.params));
        await projects.delete(project.id);
        cache.invalidate(project);
        realtime.disconnectProject(project.id);
        realtime.forgetProject(project.id);
        return reply.code(204).send();
    });

    app.post('/projects/:project/rotate-secret', async (request, reply) => {
        const id = projectIdOf(request.params);
        const result = validate('AdminSecretRotation', request.body ?? {});
        if (!result.valid) {
            throw invalid(result.errors);
        }
        const { project, secret } = await projects.rotateSecret(
            id,
            result.value.gracePeriod ?? secretGracePeriod,
        );
        cache.invalidate(project);
        const body: AdminProjectSecret = {
            secret,
            previousSecretExpiresAt: project.previousSecretExpiresAt?.toISOString() ?? null,
        };
        return reply.send(body);
    });

    app.get('/projects/:project/channels', async (request, reply) => {
        const project = await projects.get(projectIdOf(request.params));
        const query = request.query as Record<string, unknown>;
        const prefix = typeof query['prefix'] === 'string' ? query['prefix'] : '';
        const limit =
            query['limit'] === undefined || query['limit'] === ''
                ? DEFAULT_CHANNEL_LIMIT
                : Number(query['limit']);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CHANNEL_LIMIT) {
            throw invalid([
                { pointer: '/limit', message: `must be an integer from 1 to ${MAX_CHANNEL_LIMIT}` },
            ]);
        }
        const matching = realtime
            .channels(project.id)
            .filter(({ channel }) => channel.startsWith(prefix))
            .sort(
                (a, b) =>
                    b.subscriptionCount - a.subscriptionCount || a.channel.localeCompare(b.channel),
            );
        const body: AdminChannelList = {
            channels: matching.slice(0, limit).map(({ channel, subscriptionCount }) => ({
                channel,
                occupied: true,
                subscriptionCount,
            })),
            total: matching.length,
        };
        return reply.send(body);
    });

    app.get('/projects/:project/channels/:channel', async (request, reply) => {
        const project = await projects.get(projectIdOf(request.params));
        const { channel } = request.params as { channel: string };
        if (!validate('ChannelName', channel).valid) {
            throw new HttpProblem(
                422,
                'Unprocessable Content',
                `"${channel}" is not a channel name.`,
            );
        }
        const subscriptionCount = realtime.subscriptionCount(project.id, channel);
        const body: Channel = { channel, occupied: subscriptionCount > 0, subscriptionCount };
        return reply.send(body);
    });
}

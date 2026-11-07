import type { FastifyInstance, FastifyRequest } from 'fastify';

import { toProblemErrors, validate } from '@pingpong-io/protocol';
import type { Channel, Health, Origins, PublishRequest } from '@pingpong-io/protocol';
import {
    KEY_HEADER,
    SIGNATURE_HEADER,
    verifyRequestSignature,
} from '@pingpong-io/protocol/signatures';

import { ConflictError, InvalidValueError, NotFoundError } from '../errors.ts';
import type { ProjectCache } from '../projects/cache.ts';
import type { Project, Projects } from '../projects/projects.ts';
import type { Realtime } from '../realtime/realtime.ts';
import { HttpProblem } from './problem.ts';
import { RateLimiter } from './rate-limiter.ts';

declare module 'fastify' {
    interface FastifyRequest {
        /** The raw body, as signed. */
        rawBody: string;
        /** The project that signed the request, on `/v1` routes. */
        project: Project | null;
    }
}

export interface RouteDependencies {
    projects: Projects;
    cache: ProjectCache;
    realtime: Realtime;
    /** Resolves when the database and Redis answer. */
    checkHealth: () => Promise<void>;
}

function invalid(errors: Parameters<typeof toProblemErrors>[0]): HttpProblem {
    return new HttpProblem(422, 'Unprocessable Content', 'The request is invalid.', {
        errors: toProblemErrors(errors),
    });
}

function projectOf(request: FastifyRequest): Project {
    if (request.project === null) {
        throw new HttpProblem(401, 'Unauthorized');
    }
    return request.project;
}

/** The size of the largest message a publish request makes, serialized. */
function messageSize({ channels, event, data }: PublishRequest): number {
    const channel = channels.reduce(
        (longest, name) => (name.length > longest.length ? name : longest),
        '',
    );
    return Buffer.byteLength(JSON.stringify({ channel, event, data }));
}

export function registerRoutes(app: FastifyInstance, dependencies: RouteDependencies): void {
    const { projects, cache, realtime, checkHealth } = dependencies;
    const limiter = new RateLimiter();

    app.decorateRequest('rawBody', '');
    app.decorateRequest('project', null);

    app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
        request.rawBody = body as string;
        if (body === '') {
            done(null, undefined);
            return;
        }
        try {
            done(null, JSON.parse(body as string));
        } catch {
            done(new HttpProblem(400, 'Bad Request', 'The body is not valid JSON.'), undefined);
        }
    });

    app.get('/health', async (_request, reply) => {
        try {
            await checkHealth();
        } catch {
            throw new HttpProblem(
                503,
                'Service Unavailable',
                "The database or Redis doesn't answer.",
            );
        }
        const health: Health = { status: 'ok' };
        return reply.send(health);
    });

    app.register(async (v1) => {
        v1.addHook('preHandler', async (request) => {
            const key = request.headers[KEY_HEADER.toLowerCase()];
            if (typeof key !== 'string' || key === '') {
                throw new HttpProblem(401, 'Unauthorized', `The ${KEY_HEADER} header is missing.`);
            }
            const project = await cache.findByKey(key);
            if (project === undefined || project.disabled) {
                throw new HttpProblem(401, 'Unauthorized', 'Unknown or disabled project key.');
            }
            const verification = verifyRequestSignature(
                project.secrets,
                request.headers[SIGNATURE_HEADER.toLowerCase()],
                {
                    method: request.method,
                    path: request.raw.url ?? request.url,
                    body: request.rawBody,
                },
            );
            if (!verification.valid) {
                throw new HttpProblem(
                    401,
                    'Unauthorized',
                    {
                        malformed: `The ${SIGNATURE_HEADER} header is missing or malformed.`,
                        expired: `The signature's timestamp is more than five minutes from the server's clock.`,
                        mismatch: "The signature doesn't match the request.",
                    }[verification.reason],
                );
            }
            request.project = project;
        });

        const publish = (
            project: Project,
            messages: PublishRequest[],
            pointer: (index: number) => string,
        ) => {
            messages.forEach((message, index) => {
                const size = messageSize(message);
                if (size > project.limits.maxMessageSize) {
                    throw new HttpProblem(
                        413,
                        'Content Too Large',
                        `A message is ${size} bytes once serialized, more than the project's limit of ${project.limits.maxMessageSize}.`,
                        { errors: { [pointer(index)]: ['is too large'] } },
                    );
                }
            });
            const count = messages.reduce((total, message) => total + message.channels.length, 0);
            const wait = limiter.take(project.id, count, project.limits.maxMessagesPerSecond);
            if (wait > 0) {
                realtime.stats.rateLimited(project.id);
                throw new HttpProblem(
                    429,
                    'Too Many Requests',
                    `The project may publish ${project.limits.maxMessagesPerSecond} messages per second, one per channel.`,
                    { headers: { 'retry-after': String(wait) } },
                );
            }
            for (const message of messages) {
                realtime.publish(project.id, message);
            }
        };

        v1.post('/v1/messages', async (request, reply) => {
            const project = projectOf(request);
            const result = validate('PublishRequest', request.body);
            if (!result.valid) {
                throw invalid(result.errors);
            }
            publish(project, [result.value], () => '');
            return reply.code(202).send();
        });

        v1.post('/v1/messages/batch', async (request, reply) => {
            const project = projectOf(request);
            const result = validate('PublishBatchRequest', request.body);
            if (!result.valid) {
                throw invalid(result.errors);
            }
            publish(project, result.value.messages, (index) => `/messages/${index}`);
            return reply.code(202).send();
        });

        v1.get<{ Params: { channel: string } }>('/v1/channels/:channel', async (request, reply) => {
            const project = projectOf(request);
            const { channel } = request.params;
            const result = validate('ChannelName', channel);
            if (!result.valid) {
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

        v1.get('/v1/origins', async (request, reply) => {
            const body: Origins = { origins: projectOf(request).origins };
            return reply.send(body);
        });

        v1.put('/v1/origins', async (request, reply) => {
            const project = projectOf(request);
            const result = validate('Origins', request.body);
            if (!result.valid) {
                throw invalid(result.errors);
            }
            const updated = await projects.update(project.id, { origins: result.value.origins });
            cache.invalidate(updated);
            const body: Origins = { origins: updated.origins };
            return reply.send(body);
        });
    });

    app.setNotFoundHandler(() => {
        throw new HttpProblem(404, 'Not Found');
    });

    app.setErrorHandler((error: Error & { code?: string; statusCode?: number }, request, reply) => {
        const problem =
            error instanceof HttpProblem
                ? error
                : error instanceof NotFoundError
                  ? new HttpProblem(404, 'Not Found', error.message)
                  : error instanceof ConflictError
                    ? new HttpProblem(409, 'Conflict', error.message)
                    : error instanceof InvalidValueError
                      ? new HttpProblem(422, 'Unprocessable Content', error.message)
                      : error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
                        ? new HttpProblem(413, 'Content Too Large', 'The body is too large.')
                        : error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
                          ? new HttpProblem(415, 'Unsupported Media Type', 'Send application/json.')
                          : typeof error.statusCode === 'number' && error.statusCode < 500
                            ? new HttpProblem(error.statusCode, error.message)
                            : null;
        if (problem === null) {
            request.log.error(error);
            return reply
                .code(500)
                .type('application/problem+json')
                .send(new HttpProblem(500, 'Internal Server Error').toJSON());
        }
        return reply
            .code(problem.status)
            .headers(problem.headers)
            .type('application/problem+json')
            .send(problem.toJSON());
    });
}

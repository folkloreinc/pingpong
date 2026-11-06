import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Namespace, ServerOptions, Socket } from 'socket.io';

import {
    SOCKET_EVENTS,
    isPresenceChannel,
    isPrivateChannel,
    projectNamespace,
    validate,
} from '@pingpong-io/protocol';
import type {
    PublishRequest,
    SocketConnectError,
    SocketConnected,
    SocketMessage,
    SocketSubscribeError,
    SocketSubscribeResult,
} from '@pingpong-io/protocol';
import { verifyChannelSignature } from '@pingpong-io/protocol/signatures';

import { safeEqual } from '../crypto.ts';
import { isOriginAllowed } from '../origins.ts';
import type { ProjectCache } from '../projects/cache.ts';
import { SubscriptionCounts } from './counts.ts';

const PROJECT_NAMESPACE = /^\/projects\/[a-z0-9][a-z0-9-]{0,62}$/;

export interface RealtimeOptions {
    pingInterval: number;
    pingTimeout: number;
    /** How long a disconnected socket can be recovered, in milliseconds (decision 0006). */
    recoveryWindow: number;
    countInterval: number;
    /** A Socket.IO adapter, such as the Redis Streams adapter for several servers. */
    adapter?: ServerOptions['adapter'];
}

type Ack<T> = (result: T) => void;

function refuse(code: SocketConnectError): Error {
    return new Error(code);
}

function projectIdOf(namespace: Namespace): string {
    return namespace.name.slice('/projects/'.length);
}

/**
 * Socket.IO for every project: one namespace each, `/projects/{id}`, with the project's key and
 * origins checked when a socket connects (decision 0003), signed private channels (decision 0004)
 * and connection state recovery (decision 0006).
 */
export class Realtime {
    readonly io: Server;
    readonly #projects: ProjectCache;
    readonly #counts: SubscriptionCounts;

    constructor(httpServer: HttpServer, projects: ProjectCache, options: RealtimeOptions) {
        this.#projects = projects;
        this.#counts = new SubscriptionCounts(options.countInterval);
        this.io = new Server(httpServer, {
            pingInterval: options.pingInterval,
            pingTimeout: options.pingTimeout,
            connectionStateRecovery: {
                maxDisconnectionDuration: options.recoveryWindow,
                skipMiddlewares: true,
            },
            // Browsers send credentials-less requests from any origin: each project's middleware
            // checks the `Origin` header against the project's origins.
            cors: { origin: true },
            serveClient: false,
            ...(options.adapter === undefined ? {} : { adapter: options.adapter }),
        });

        // Clients only connect to a project's namespace.
        this.io.of('/').use((_socket, next) => next(refuse('unknown_project')));

        const namespaces = this.io.of(PROJECT_NAMESPACE);
        namespaces.use((socket, next) => {
            this.#authorize(socket).then(
                () => next(),
                (error: unknown) => next(error instanceof Error ? error : new Error(String(error))),
            );
        });
        namespaces.on('connection', (socket) => this.#onConnection(socket));
        this.io.on('new_namespace', (namespace: Namespace) => {
            if (PROJECT_NAMESPACE.test(namespace.name)) {
                this.#counts.track(namespace);
            }
        });
    }

    async #authorize(socket: Socket): Promise<void> {
        const project = await this.#projects.find(projectIdOf(socket.nsp));
        if (project === undefined) {
            throw refuse('unknown_project');
        }
        if (project.disabled) {
            throw refuse('project_disabled');
        }
        const auth: unknown = socket.handshake.auth;
        const key = typeof auth === 'object' && auth !== null && 'key' in auth ? auth.key : null;
        if (typeof key !== 'string' || !safeEqual(key, project.key)) {
            throw refuse('invalid_key');
        }
        const origin = socket.handshake.headers.origin;
        if (origin !== undefined && !isOriginAllowed(project.origins, origin)) {
            throw refuse('origin_not_allowed');
        }
        if (socket.nsp.sockets.size >= project.limits.maxConnections) {
            throw refuse('too_many_connections');
        }
    }

    #onConnection(socket: Socket): void {
        // The first packet, broadcast to the socket's own room, gives the client an offset:
        // without one, it couldn't be recovered (decision 0006).
        const connected: SocketConnected = { socketId: socket.id, recovered: socket.recovered };
        socket.nsp.to(socket.id).emit(SOCKET_EVENTS.connected, connected);

        socket.on(SOCKET_EVENTS.subscribe, (request: unknown, ack: unknown) => {
            this.#subscribe(socket, request).then(
                (result) =>
                    typeof ack === 'function'
                        ? (ack as Ack<SocketSubscribeResult>)(result)
                        : undefined,
                () =>
                    typeof ack === 'function'
                        ? (ack as Ack<SocketSubscribeResult>)({
                              ok: false,
                              error: 'invalid_request',
                          })
                        : undefined,
            );
        });

        socket.on(SOCKET_EVENTS.unsubscribe, (request: unknown, ack: unknown) => {
            if (validate('SocketUnsubscribeRequest', request).valid) {
                void socket.leave((request as { channel: string }).channel);
            }
            if (typeof ack === 'function') {
                (ack as Ack<{ ok: true }>)({ ok: true });
            }
        });
    }

    async #subscribe(socket: Socket, request: unknown): Promise<SocketSubscribeResult> {
        const failure = (error: SocketSubscribeError): SocketSubscribeResult => ({
            ok: false,
            error,
        });
        const result = validate('SocketSubscribeRequest', request);
        if (!result.valid) {
            return failure('invalid_request');
        }
        const { channel, signature } = result.value;
        if (isPresenceChannel(channel)) {
            return failure('unsupported_channel');
        }
        const project = await this.#projects.find(projectIdOf(socket.nsp));
        if (project === undefined || project.disabled) {
            return failure('invalid_request');
        }
        if (
            isPrivateChannel(channel) &&
            !verifyChannelSignature(project.secrets, socket.id, channel, signature)
        ) {
            return failure('invalid_signature');
        }
        const channels = [...socket.rooms].filter((room) => room !== socket.id);
        if (!socket.rooms.has(channel) && channels.length >= project.limits.maxChannelsPerSocket) {
            return failure('too_many_channels');
        }
        await socket.join(channel);
        return { ok: true, subscriptionCount: SubscriptionCounts.count(socket.nsp, channel) };
    }

    #namespace(projectId: string): Namespace {
        // Returns the child of the dynamic namespace, with its middleware, even before a client
        // connected (tested by the phase 0 spike).
        return this.io.of(projectNamespace(projectId));
    }

    /** Sends a message to the subscribers of its channels, once per channel. */
    publish(projectId: string, message: PublishRequest): void {
        const namespace = this.#namespace(projectId);
        for (const channel of message.channels) {
            const payload: SocketMessage = {
                channel,
                event: message.event,
                ...(message.data === undefined ? {} : { data: message.data }),
            };
            const target =
                message.exceptSocketId === undefined
                    ? namespace.to(channel)
                    : namespace.to(channel).except(message.exceptSocketId);
            target.emit(SOCKET_EVENTS.message, payload);
        }
    }

    /** The number of sockets subscribed to a channel of a project, on this server. */
    subscriptionCount(projectId: string, channel: string): number {
        return SubscriptionCounts.count(this.#namespace(projectId), channel);
    }

    /** Sends the subscription counts that changed now, instead of at the next interval. */
    flushCounts(): void {
        this.#counts.flush();
    }

    /** Disconnects every socket and closes the HTTP server. */
    async close(): Promise<void> {
        this.#counts.close();
        await this.io.close();
    }
}

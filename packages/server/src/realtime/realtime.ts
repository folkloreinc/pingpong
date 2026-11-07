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
import type { Project } from '../projects/projects.ts';
import { SubscriptionCounts } from './counts.ts';
import { ProjectStats } from './stats.ts';

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
    /** What this server counted per project since it started (decision 0009). */
    readonly stats = new ProjectStats();
    readonly #projects: ProjectCache;
    readonly #counts: SubscriptionCounts;
    /** The parent of the projects' namespaces. */
    readonly #parent: Namespace;
    /** The connections being authorized, by namespace. */
    readonly #authorizing = new Map<Namespace, number>();

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

        this.#parent = this.io.of(PROJECT_NAMESPACE);
        this.#parent.use((socket, next) => {
            const namespace = socket.nsp;
            this.#authorizing.set(namespace, (this.#authorizing.get(namespace) ?? 0) + 1);
            const done = () => {
                const count = (this.#authorizing.get(namespace) ?? 1) - 1;
                if (count > 0) {
                    this.#authorizing.set(namespace, count);
                } else {
                    this.#authorizing.delete(namespace);
                }
            };
            this.#authorize(socket).then(
                () => {
                    done();
                    next();
                },
                (error: unknown) => {
                    done();
                    const refusal = error instanceof Error ? error : new Error(String(error));
                    if (refusal.message === 'unknown_project') {
                        this.#closeUnused(namespace);
                    }
                    next(refusal);
                },
            );
        });
        this.#parent.on('connection', (socket) => this.#onConnection(socket));
        this.io.on('new_namespace', (namespace: Namespace) => {
            if (PROJECT_NAMESPACE.test(namespace.name)) {
                this.#counts.track(namespace);
            }
        });
    }

    async #authorize(socket: Socket): Promise<void> {
        const projectId = projectIdOf(socket.nsp);
        const project = await this.#projects.find(projectId);
        if (project === undefined) {
            // Not counted: any id can be tried, and only projects have counters.
            throw refuse('unknown_project');
        }
        const reason = this.#refusal(socket, project);
        if (reason !== undefined) {
            this.stats.refused(projectId, reason);
            throw refuse(reason);
        }
    }

    /**
     * Closes the namespace of a project that doesn't exist, which Socket.IO opened for the attempt
     * before the middleware refused it: any id can be tried, and each would keep a namespace for
     * good. A namespace with a socket, or a connection being authorized, stays.
     */
    #closeUnused(namespace: Namespace): void {
        if (namespace.sockets.size > 0 || this.#authorizing.has(namespace)) {
            return;
        }
        this.#counts.untrack(namespace);
        void namespace.adapter.close();
        this.io._nsps.delete(namespace.name);
        // Socket.IO's own cleanup of empty child namespaces (`cleanupEmptyChildNamespaces`) does the
        // same, but only when a connected socket leaves.
        (this.#parent as unknown as { children: Set<Namespace> }).children.delete(namespace);
    }

    #refusal(socket: Socket, project: Project): SocketConnectError | undefined {
        if (project.disabled) {
            return 'project_disabled';
        }
        const auth: unknown = socket.handshake.auth;
        const key = typeof auth === 'object' && auth !== null && 'key' in auth ? auth.key : null;
        if (typeof key !== 'string' || !safeEqual(key, project.key)) {
            return 'invalid_key';
        }
        const origin = socket.handshake.headers.origin;
        if (origin !== undefined && !isOriginAllowed(project.origins, origin)) {
            return 'origin_not_allowed';
        }
        if (socket.nsp.sockets.size >= project.limits.maxConnections) {
            return 'too_many_connections';
        }
        return undefined;
    }

    #onConnection(socket: Socket): void {
        // The first packet, broadcast to the socket's own room, gives the client an offset:
        // without one, it couldn't be recovered (decision 0006).
        this.stats.connected(projectIdOf(socket.nsp), socket.nsp.sockets.size);
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
        // The payload's size without its channel: channel names need no escaping in JSON.
        const size = Buffer.byteLength(
            JSON.stringify({ channel: '', event: message.event, data: message.data }),
        );
        this.stats.published(
            projectId,
            message.channels.length,
            message.channels.reduce((total, channel) => total + size + channel.length, 0),
        );
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
        // A project this server hasn't seen has no subscriber here: no namespace is opened for it.
        const namespace = this.#openNamespace(projectId);
        return namespace === undefined ? 0 : SubscriptionCounts.count(namespace, channel);
    }

    /**
     * A project's namespace, if this server opened it: a client tried to connect, or a message was
     * published. Unlike `#namespace()`, it doesn't open one.
     */
    #openNamespace(projectId: string): Namespace | undefined {
        return this.io._nsps.get(projectNamespace(projectId));
    }

    /** The sockets connected to a project on this server. */
    connections(projectId: string): number {
        return this.#openNamespace(projectId)?.sockets.size ?? 0;
    }

    /** The channels of a project that sockets of this server are subscribed to, and how many. */
    channels(projectId: string): { channel: string; subscriptionCount: number }[] {
        const namespace = this.#openNamespace(projectId);
        if (namespace === undefined) {
            return [];
        }
        const { rooms, sids } = namespace.adapter;
        // Every socket is in a room named after its id: it isn't a channel.
        return [...rooms]
            .filter(([room, sockets]) => !sids.has(room) && sockets.size > 0)
            .map(([channel, sockets]) => ({ channel, subscriptionCount: sockets.size }));
    }

    /** The projects whose namespace this server opened, by id. */
    projectIds(): string[] {
        return [...this.io._nsps.values()]
            .filter((namespace) => PROJECT_NAMESPACE.test(namespace.name))
            .map(projectIdOf);
    }

    /**
     * Disconnects every socket of a project, on every server (through the adapter), after it was
     * disabled or deleted. Its clients don't reconnect by themselves: the server closed them.
     */
    disconnectProject(projectId: string): void {
        this.#namespace(projectId).disconnectSockets();
    }

    /** Forgets a deleted project's counters. */
    forgetProject(projectId: string): void {
        this.stats.forget(projectId);
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

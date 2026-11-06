import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import type { Namespace, ServerOptions } from 'socket.io';

import { isPrivateChannel, verifyChannelSignature } from './signature.ts';

export interface SpikeProject {
    id: string;
    key: string;
    secret: string;
    origins: string[];
}

export interface Message {
    channel: string;
    event: string;
    data: unknown;
}

export interface SubscribeRequest {
    channel: string;
    signature?: string;
}

export type SubscribeResult = { ok: true } | { ok: false; error: string };

export interface SpikeServer {
    io: Server;
    port: number;
    url: string;
    /** What the HTTP API will do: send a message to a channel of a project. */
    publish(projectId: string, message: Message): void;
    close(): Promise<void>;
}

const PROJECT_NAMESPACE = /^\/projects\/[a-z0-9_-]+$/;

/**
 * A throwaway server for the phase 0 spike: one Socket.IO namespace per project, the project's key
 * and origin checked when a socket connects, signed private channels, and connection state
 * recovery. Not the design of `@pingpong-io/server`.
 */
export async function startSpikeServer(
    projects: SpikeProject[],
    options: Partial<ServerOptions> = {},
    { connectedPacket = true }: { connectedPacket?: boolean } = {},
): Promise<SpikeServer> {
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const httpServer = createServer();
    const io = new Server(httpServer, {
        connectionStateRecovery: {
            maxDisconnectionDuration: 2 * 60 * 1000,
            skipMiddlewares: true,
        },
        ...options,
    });

    // Clients only connect to a project's namespace.
    io.of('/').use((_socket, next) => next(new Error('unknown_namespace')));

    const namespaces = io.of(PROJECT_NAMESPACE);
    namespaces.use((socket, next) => {
        const project = projectsById.get(projectIdOf(socket.nsp));
        if (project === undefined) {
            return next(new Error('unknown_project'));
        }
        const auth: unknown = socket.handshake.auth;
        const key = typeof auth === 'object' && auth !== null && 'key' in auth ? auth.key : null;
        if (key !== project.key) {
            return next(new Error('invalid_key'));
        }
        const origin = socket.handshake.headers.origin;
        if (origin !== undefined && !project.origins.includes(origin)) {
            return next(new Error('origin_not_allowed'));
        }
        next();
    });

    namespaces.on('connection', (socket) => {
        const project = projectsById.get(projectIdOf(socket.nsp));
        // Connection state recovery needs the offset of a broadcast packet the client received. A
        // client that received nothing yet would start over after a drop, and miss what was
        // published meanwhile. A first packet, broadcast to the socket's own room, gives it one.
        if (connectedPacket) {
            socket.nsp.to(socket.id).emit('pingpong:connected');
        }
        socket.on(
            'subscribe',
            (request: SubscribeRequest, ack: (result: SubscribeResult) => void) => {
                if (project === undefined || typeof request?.channel !== 'string') {
                    return ack({ ok: false, error: 'invalid_request' });
                }
                if (
                    isPrivateChannel(request.channel) &&
                    !verifyChannelSignature(
                        project.secret,
                        socket.id,
                        request.channel,
                        request.signature,
                    )
                ) {
                    return ack({ ok: false, error: 'invalid_signature' });
                }
                socket.join(request.channel);
                ack({ ok: true });
            },
        );
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const { port } = httpServer.address() as AddressInfo;

    return {
        io,
        port,
        url: `http://127.0.0.1:${port}`,
        publish(projectId, message) {
            io.of(`/projects/${projectId}`).to(message.channel).emit('message', message);
        },
        close: () => new Promise((resolve) => io.close(() => resolve())),
    };
}

function projectIdOf(namespace: Namespace): string {
    return namespace.name.slice('/projects/'.length);
}

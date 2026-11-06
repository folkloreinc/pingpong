import { io } from 'socket.io-client';
import type { ManagerOptions, Socket, SocketOptions } from 'socket.io-client';

import type { Message, SubscribeRequest, SubscribeResult } from './server.ts';

export function connectClient(
    url: string,
    projectId: string,
    key: string,
    options: Partial<ManagerOptions & SocketOptions> = {},
): Socket {
    return io(`${url}/projects/${projectId}`, {
        auth: { key },
        forceNew: true,
        reconnectionDelay: 50,
        reconnectionDelayMax: 100,
        ...options,
    });
}

/** Resolves on `connect`, rejects with the middleware's error on `connect_error`. */
export function connected(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', (error) => reject(error));
    });
}

export function once<T = void>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve) => socket.once(event, (value: T) => resolve(value)));
}

export function subscribe(socket: Socket, request: SubscribeRequest): Promise<SubscribeResult> {
    return socket.timeout(2000).emitWithAck('subscribe', request);
}

/** Collects the messages a socket receives, in order. */
export function collectMessages(socket: Socket): Message[] {
    const messages: Message[] = [];
    socket.on('message', (message: Message) => messages.push(message));
    return messages;
}

export async function waitUntil(condition: () => boolean, timeout = 5000): Promise<void> {
    const start = Date.now();
    while (!condition()) {
        if (Date.now() - start > timeout) {
            throw new Error('Timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

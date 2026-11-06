import { io } from 'socket.io-client';
import type { ManagerOptions, Socket, SocketOptions } from 'socket.io-client';

import type {
    SocketConnectError,
    SocketConnected,
    SocketMessage,
    SocketSubscribeError,
    SocketSubscribeResult,
    SocketSubscriptionCount,
} from '@pingpong-io/protocol';
import { SOCKET_EVENTS, isPrivateChannel, projectNamespace } from '@pingpong-io/protocol/events';

import { Emitter } from './emitter.ts';

/** Asks the application for the signature of a private channel. */
export type Authorizer = (request: { socketId: string; channel: string }) => Promise<string>;

export interface PingpongOptions {
    /** The server, such as `https://pingpong.example.com`. */
    url: string;
    project: string;
    /** The project's public key. */
    key: string;
    /** Needed to subscribe to private channels. */
    authorize?: Authorizer;
    /** Connects at once. True by default; false to call `connect()` later. */
    autoConnect?: boolean;
    /** Passed to socket.io-client, such as `path` when Pingpong is served under a path. */
    socketOptions?: Partial<ManagerOptions & SocketOptions>;
    /** How long to wait before connecting again after `too_many_connections`, in milliseconds. */
    retryDelay?: number;
}

/** Errors that a client can't fix by connecting again. */
const FINAL_ERRORS: readonly string[] = [
    'unknown_project',
    'invalid_key',
    'origin_not_allowed',
    'project_disabled',
] satisfies SocketConnectError[];

export type SubscriptionState = 'pending' | 'subscribed' | 'failed' | 'closed';

export type SubscriptionError =
    | { code: SocketSubscribeError }
    | { code: 'authorization_failed'; cause: unknown }
    | { code: 'timeout' };

export interface SubscriptionEvents extends Record<string, unknown> {
    message: SocketMessage;
    subscribed: { subscriptionCount: number };
    subscriptionCount: number;
    error: SubscriptionError;
}

export interface ClientEvents extends Record<string, unknown> {
    /** After each connection. `recovered` says whether the channels and missed messages came back. */
    connected: SocketConnected;
    /**
     * The client reconnected without being recovered: it subscribed to its channels again, but may
     * have missed messages. Reload what you show from the application.
     */
    reset: undefined;
    disconnected: string;
    /** The server refused the connection for good (`invalid_key`…), or another error. */
    error: { code: string; message: string };
    message: SocketMessage;
    subscriptionCount: SocketSubscriptionCount;
}

/** A subscription to a channel. Several subscriptions to one channel share it on the server. */
export class Subscription extends Emitter<SubscriptionEvents> {
    readonly channel: string;
    #state: SubscriptionState = 'pending';
    #subscriptionCount: number | undefined;
    readonly #client: Pingpong;

    constructor(client: Pingpong, channel: string) {
        super();
        this.#client = client;
        this.channel = channel;
    }

    get state(): SubscriptionState {
        return this.#state;
    }

    /** How many sockets are subscribed to the channel, as last reported by the server. */
    get subscriptionCount(): number | undefined {
        return this.#subscriptionCount;
    }

    unsubscribe(): void {
        if (this.#state === 'closed') {
            return;
        }
        this.#state = 'closed';
        this.#client.release(this);
        this.removeAllListeners();
    }

    /** @internal */
    setState(state: SubscriptionState): void {
        if (this.#state !== 'closed') {
            this.#state = state;
        }
    }

    /** @internal */
    dispatch<E extends keyof SubscriptionEvents>(event: E, payload: SubscriptionEvents[E]): void {
        if (event === 'subscriptionCount') {
            this.#subscriptionCount = payload as number;
        }
        if (event === 'subscribed') {
            this.#subscriptionCount = (payload as { subscriptionCount: number }).subscriptionCount;
        }
        this.emit(event, payload);
    }
}

/**
 * A client of a Pingpong project. It subscribes to channels and keeps them across reconnections:
 * when the server can't recover the socket, it subscribes again, with new signatures for private
 * channels, and emits `reset`.
 */
export class Pingpong extends Emitter<ClientEvents> {
    readonly socket: Socket;
    readonly #options: PingpongOptions;
    readonly #subscriptions = new Map<string, Set<Subscription>>();
    #connectedOnce = false;
    #retryTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(options: PingpongOptions) {
        super();
        this.#options = options;
        this.socket = io(`${options.url.replace(/\/+$/, '')}${projectNamespace(options.project)}`, {
            ...options.socketOptions,
            autoConnect: false,
            auth: { key: options.key },
        });
        this.socket.on(SOCKET_EVENTS.connected, (payload: SocketConnected) =>
            this.#onConnected(payload),
        );
        this.socket.on(SOCKET_EVENTS.message, (message: SocketMessage) => this.#onMessage(message));
        this.socket.on(SOCKET_EVENTS.subscriptionCount, (count: SocketSubscriptionCount) => {
            for (const subscription of this.#subscriptions.get(count.channel) ?? []) {
                subscription.dispatch('subscriptionCount', count.subscriptionCount);
            }
            this.emit('subscriptionCount', count);
        });
        this.socket.on('disconnect', (reason) => this.emit('disconnected', reason));
        this.socket.on('connect_error', (error) => this.#onConnectError(error));
        if (options.autoConnect !== false) {
            this.connect();
        }
    }

    get connected(): boolean {
        return this.socket.connected;
    }

    connect(): this {
        this.socket.connect();
        return this;
    }

    /** Disconnects for good: subscriptions are kept, and `connect()` subscribes again. */
    disconnect(): this {
        clearTimeout(this.#retryTimer);
        this.socket.disconnect();
        return this;
    }

    /** Subscribes to a channel. The listener, if any, receives its messages. */
    subscribe(channel: string, listener?: (message: SocketMessage) => void): Subscription {
        const subscription = new Subscription(this, channel);
        if (listener !== undefined) {
            subscription.on('message', listener);
        }
        let subscriptions = this.#subscriptions.get(channel);
        const first = subscriptions === undefined;
        if (subscriptions === undefined) {
            subscriptions = new Set();
            this.#subscriptions.set(channel, subscriptions);
        }
        subscriptions.add(subscription);
        if (first) {
            if (this.socket.connected && this.#connectedOnce) {
                void this.#join(channel);
            }
        } else {
            const subscribed = [...subscriptions].find((other) => other.state === 'subscribed');
            if (subscribed !== undefined) {
                subscription.setState('subscribed');
                queueMicrotask(() =>
                    subscription.dispatch('subscribed', {
                        subscriptionCount: subscribed.subscriptionCount ?? 1,
                    }),
                );
            }
        }
        return subscription;
    }

    /** The channels the client is subscribed to. */
    get channels(): string[] {
        return [...this.#subscriptions.keys()];
    }

    /** @internal Called by `Subscription.unsubscribe()`. */
    release(subscription: Subscription): void {
        const subscriptions = this.#subscriptions.get(subscription.channel);
        subscriptions?.delete(subscription);
        if (subscriptions?.size === 0) {
            this.#subscriptions.delete(subscription.channel);
            if (this.socket.connected) {
                this.socket.emit(SOCKET_EVENTS.unsubscribe, { channel: subscription.channel });
            }
        }
    }

    /** Disconnects and forgets every subscription. */
    close(): void {
        for (const subscriptions of [...this.#subscriptions.values()]) {
            for (const subscription of [...subscriptions]) {
                subscription.unsubscribe();
            }
        }
        this.disconnect();
        this.removeAllListeners();
    }

    #onConnected(payload: SocketConnected): void {
        const first = !this.#connectedOnce;
        this.#connectedOnce = true;
        if (!payload.recovered) {
            for (const channel of this.#subscriptions.keys()) {
                void this.#join(channel);
            }
        }
        this.emit('connected', payload);
        if (!first && !payload.recovered) {
            this.emit('reset', undefined);
        }
    }

    #onMessage(message: SocketMessage): void {
        for (const subscription of this.#subscriptions.get(message.channel) ?? []) {
            subscription.dispatch('message', message);
        }
        this.emit('message', message);
    }

    #onConnectError(error: Error): void {
        if (this.socket.active) {
            // A network error: socket.io-client connects again by itself.
            return;
        }
        this.emit('error', { code: error.message, message: error.message });
        if (!FINAL_ERRORS.includes(error.message)) {
            this.#retryTimer = setTimeout(() => this.connect(), this.#options.retryDelay ?? 5000);
        }
    }

    async #join(channel: string): Promise<void> {
        const subscriptions = () => [...(this.#subscriptions.get(channel) ?? [])];
        const fail = (error: SubscriptionError) => {
            for (const subscription of subscriptions()) {
                subscription.setState('failed');
                subscription.dispatch('error', error);
            }
        };
        subscriptions().forEach((subscription) => subscription.setState('pending'));
        const socketId = this.socket.id;
        if (socketId === undefined) {
            return;
        }
        let signature: string | undefined;
        if (isPrivateChannel(channel)) {
            if (this.#options.authorize === undefined) {
                fail({ code: 'authorization_failed', cause: new Error('No authorize option.') });
                return;
            }
            try {
                signature = await this.#options.authorize({ socketId, channel });
            } catch (cause) {
                fail({ code: 'authorization_failed', cause });
                return;
            }
            // The socket changed while the application signed: the next connection subscribes.
            if (this.socket.id !== socketId) {
                return;
            }
        }
        let result: SocketSubscribeResult;
        try {
            result = await this.socket.timeout(10_000).emitWithAck(SOCKET_EVENTS.subscribe, {
                channel,
                ...(signature === undefined ? {} : { signature }),
            });
        } catch {
            if (this.socket.connected) {
                fail({ code: 'timeout' });
            }
            return;
        }
        if (!this.#subscriptions.has(channel)) {
            // Unsubscribed while subscribing.
            this.socket.emit(SOCKET_EVENTS.unsubscribe, { channel });
            return;
        }
        if (!result.ok) {
            fail({ code: result.error });
            return;
        }
        for (const subscription of subscriptions()) {
            subscription.setState('subscribed');
            subscription.dispatch('subscribed', { subscriptionCount: result.subscriptionCount });
        }
    }
}

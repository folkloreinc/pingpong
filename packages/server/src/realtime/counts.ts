import type { Namespace } from 'socket.io';

import { SOCKET_EVENTS } from '@pingpong-io/protocol';
import type { SocketSubscriptionCount } from '@pingpong-io/protocol';

/**
 * Sends `pingpong:subscription_count` to a channel's subscribers when the number of sockets
 * subscribed to it changes, at most once per interval per channel. It counts the sockets of this
 * server: with several servers, counts kept in Redis come later.
 */
export class SubscriptionCounts {
    readonly #dirty = new Map<Namespace, Set<string>>();
    readonly #sent = new Map<Namespace, Map<string, number>>();
    readonly #timer: NodeJS.Timeout;

    constructor(interval: number) {
        this.#timer = setInterval(() => this.flush(), interval);
        this.#timer.unref();
    }

    /** Follows the channels of a project's namespace. */
    track(namespace: Namespace): void {
        const mark = (room: string, socketId: string) => {
            // Every socket is in a room named after its id: it isn't a channel.
            if (room === socketId) {
                return;
            }
            let channels = this.#dirty.get(namespace);
            if (channels === undefined) {
                channels = new Set();
                this.#dirty.set(namespace, channels);
            }
            channels.add(room);
        };
        namespace.adapter.on('join-room', mark);
        namespace.adapter.on('leave-room', mark);
    }

    /** The number of sockets of this server subscribed to a channel. */
    static count(namespace: Namespace, channel: string): number {
        return namespace.adapter.rooms.get(channel)?.size ?? 0;
    }

    /** Sends the counts that changed since the last flush. */
    flush(): void {
        for (const [namespace, channels] of this.#dirty) {
            this.#dirty.delete(namespace);
            let sent = this.#sent.get(namespace);
            if (sent === undefined) {
                sent = new Map();
                this.#sent.set(namespace, sent);
            }
            for (const channel of channels) {
                const subscriptionCount = SubscriptionCounts.count(namespace, channel);
                if (subscriptionCount === (sent.get(channel) ?? 0)) {
                    continue;
                }
                if (subscriptionCount === 0) {
                    sent.delete(channel);
                    continue;
                }
                sent.set(channel, subscriptionCount);
                const payload: SocketSubscriptionCount = { channel, subscriptionCount };
                namespace.to(channel).emit(SOCKET_EVENTS.subscriptionCount, payload);
            }
        }
    }

    close(): void {
        clearInterval(this.#timer);
    }
}

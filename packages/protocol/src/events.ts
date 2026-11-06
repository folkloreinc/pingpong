/** The Socket.IO events of the protocol, by name. */
export const SOCKET_EVENTS = {
    /** Server to client, first after each connection: `SocketConnected`. */
    connected: 'pingpong:connected',
    /** Client to server, acknowledged: `SocketSubscribeRequest`, then `SocketSubscribeResult`. */
    subscribe: 'subscribe',
    /** Client to server, acknowledged: `SocketUnsubscribeRequest`, then `{ ok: true }`. */
    unsubscribe: 'unsubscribe',
    /** Server to client: `SocketMessage`. */
    message: 'message',
    /** Server to client: `SocketSubscriptionCount`. */
    subscriptionCount: 'pingpong:subscription_count',
} as const;

/** A project's namespace. */
export function projectNamespace(project: string): string {
    return `/projects/${project}`;
}

/** Whether a channel needs a signature from the application. */
export function isPrivateChannel(channel: string): boolean {
    return channel.startsWith('private-') || channel.startsWith('presence-');
}

/** Whether a channel is a presence channel (not supported yet). */
export function isPresenceChannel(channel: string): boolean {
    return channel.startsWith('presence-');
}

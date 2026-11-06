import { connect, createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';

export interface Proxy {
    url: string;
    /** Sends new connections to another server, as a load balancer would. */
    setTarget(port: number): void;
    /**
     * Cuts every open connection and refuses new ones for a while, as a network outage would.
     * Cutting connections alone doesn't disconnect a long-polling client: it opens a new one.
     */
    interrupt(duration: number): Promise<void>;
    close(): Promise<void>;
}

/** A TCP proxy in front of the spike server, to cut the network from the outside. */
export async function startProxy(initialTargetPort: number): Promise<Proxy> {
    let targetPort = initialTargetPort;
    let paused = false;
    const sockets = new Set<Socket>();
    const server = createServer((client) => {
        if (paused) {
            client.destroy();
            return;
        }
        const upstream = connect(targetPort, '127.0.0.1');
        for (const socket of [client, upstream]) {
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
            socket.on('error', () => socket.destroy());
        }
        client.pipe(upstream).pipe(client);
        client.on('close', () => upstream.destroy());
        upstream.on('close', () => client.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const dropConnections = () => {
        for (const socket of sockets) {
            socket.destroy();
        }
    };

    return {
        url: `http://127.0.0.1:${port}`,
        setTarget: (port) => {
            targetPort = port;
        },
        interrupt: async (duration) => {
            paused = true;
            dropConnections();
            await new Promise((resolve) => setTimeout(resolve, duration));
            paused = false;
        },
        close: () =>
            new Promise((resolve) => {
                dropConnections();
                server.close(() => resolve());
            }),
    };
}

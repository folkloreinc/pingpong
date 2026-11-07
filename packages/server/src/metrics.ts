import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

import type { Database } from './database/connection.ts';
import type { Realtime } from './realtime/realtime.ts';
import type { ProjectCounters } from './realtime/stats.ts';

type CounterName = 'messages' | 'bytes' | 'rateLimited';

/**
 * Prometheus metrics of this server (decision 0010), labelled by project. Only projects in the
 * database are labels: an id anyone can try never is. Counters grow with the live stats of 0009.
 */
export class Metrics {
    readonly registry = new Registry();

    constructor(database: Database, realtime: Realtime) {
        collectDefaultMetrics({ register: this.registry, prefix: 'pingpong_' });
        const projectIds = async () =>
            (await database.kysely.selectFrom('projects').select('id').execute()).map(
                (row) => row.id,
            );
        const registers = [this.registry];

        new Gauge({
            name: 'pingpong_connections',
            help: 'Sockets connected to each project on this server.',
            labelNames: ['project'],
            registers,
            async collect() {
                this.reset();
                for (const id of await projectIds()) {
                    this.set({ project: id }, realtime.connections(id));
                }
            },
        });
        new Gauge({
            name: 'pingpong_channels',
            help: 'Channels of each project with at least one subscriber on this server.',
            labelNames: ['project'],
            registers,
            async collect() {
                this.reset();
                for (const id of await projectIds()) {
                    this.set({ project: id }, realtime.channels(id).length);
                }
            },
        });

        // Counters follow the live stats: they grow by what the stats grew since the last scrape.
        const seen = new Map<string, number>();
        const grow = (
            counter: Counter<string>,
            key: string,
            labels: Record<string, string>,
            value: number,
        ) => {
            const previous = seen.get(key) ?? 0;
            const increase = value >= previous ? value - previous : value;
            seen.set(key, value);
            counter.inc(labels, increase);
        };
        const counter = (
            name: string,
            help: string,
            read: (counters: ProjectCounters) => number,
            field: CounterName,
        ) =>
            new Counter({
                name,
                help,
                labelNames: ['project'],
                registers,
                async collect() {
                    for (const id of await projectIds()) {
                        const counters = realtime.stats.peek(id);
                        grow(
                            this,
                            `${field}\n${id}`,
                            { project: id },
                            counters === undefined ? 0 : read(counters),
                        );
                    }
                },
            });
        counter(
            'pingpong_messages_total',
            'Messages published by each project: one per channel of each publish request.',
            (counters) => counters.messages,
            'messages',
        );
        counter(
            'pingpong_message_bytes_total',
            'Bytes of the messages published by each project, serialized.',
            (counters) => counters.bytes,
            'bytes',
        );
        counter(
            'pingpong_rate_limited_total',
            'Publish requests of each project refused by its limit of messages per second.',
            (counters) => counters.rateLimited,
            'rateLimited',
        );
        new Counter({
            name: 'pingpong_connections_refused_total',
            help: 'Connections to each project refused, by reason.',
            labelNames: ['project', 'reason'],
            registers,
            async collect() {
                for (const id of await projectIds()) {
                    const refused = realtime.stats.peek(id)?.connectionsRefused ?? {};
                    for (const [reason, count] of Object.entries(refused)) {
                        grow(this, `refused\n${id}\n${reason}`, { project: id, reason }, count);
                    }
                }
            },
        });
    }
}

/** The listener of `/metrics`, apart from the API, so a reverse proxy never exposes it. */
export interface MetricsServer {
    /** Resolves with the address, such as `http://127.0.0.1:9464`. */
    listen(host: string, port: number): Promise<string>;
    close(): Promise<void>;
}

export function createMetricsServer(metrics: Metrics): MetricsServer {
    const server: HttpServer = createServer((request, response) => {
        if (request.method !== 'GET' || request.url?.split('?')[0] !== '/metrics') {
            response.writeHead(404, { 'content-type': 'text/plain' }).end('Not Found\n');
            return;
        }
        metrics.registry.metrics().then(
            (body) =>
                response.writeHead(200, { 'content-type': metrics.registry.contentType }).end(body),
            () =>
                response
                    .writeHead(500, { 'content-type': 'text/plain' })
                    .end('Internal Server Error\n'),
        );
    });
    return {
        listen: (host, port) =>
            new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, host, () => {
                    const address = server.address() as AddressInfo;
                    const name =
                        address.family === 'IPv6' ? `[${address.address}]` : address.address;
                    resolve(`http://${name}:${address.port}`);
                });
            }),
        close: () =>
            new Promise((resolve, reject) => {
                if (!server.listening) {
                    resolve();
                    return;
                }
                server.close((error) => (error === undefined ? resolve() : reject(error)));
            }),
    };
}

import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';
import type { ManagerOptions, SocketOptions } from 'socket.io-client';

import { signRequest } from '@pingpong-io/protocol/signatures';

import { loadConfig } from './config.ts';
import type { Config } from './config.ts';
import type { Database } from './database/connection.ts';
import { createTestDatabase } from './database/testing.ts';
import type { Project, ProjectInput } from './projects/projects.ts';
import { createPingpongServer } from './server.ts';
import type { PingpongServer } from './server.ts';

/** A fixed key for tests: never use it elsewhere. */
export const TEST_SECRET_KEY = '0'.repeat(64);

export interface TestProject {
    project: Project;
    secret: string;
}

export interface TestServer {
    url: string;
    server: PingpongServer;
    database: Database;
    config: Config;
    createProject(id: string, input?: ProjectInput): Promise<TestProject>;
    /** Sends a request signed with the project's secret. */
    request(
        project: TestProject,
        method: string,
        path: string,
        body?: unknown,
        options?: { secret?: string; timestamp?: number },
    ): Promise<Response>;
    /** Connects a Socket.IO client to a project's namespace with its key. */
    connect(
        project: TestProject | string,
        key?: string,
        options?: Partial<ManagerOptions & SocketOptions>,
    ): Socket;
    close(): Promise<void>;
}

/**
 * Starts a server on a free port, on an empty test database (`PINGPONG_TEST_DATABASE_URL`, or
 * SQLite in memory), with short intervals. Closes the clients it connected when it closes.
 */
export async function startTestServer(env: Record<string, string> = {}): Promise<TestServer> {
    const config = loadConfig({
        PINGPONG_DATABASE_URL: 'sqlite::memory:',
        PINGPONG_SECRET_KEY: TEST_SECRET_KEY,
        PINGPONG_HOST: '127.0.0.1',
        PINGPONG_PORT: '0',
        PINGPONG_COUNT_INTERVAL: '100',
        PINGPONG_PROJECT_CACHE_TTL: '0',
        PINGPONG_PING_INTERVAL: '200',
        PINGPONG_PING_TIMEOUT: '200',
        ...env,
    });
    const database = await createTestDatabase();
    const server = await createPingpongServer(config, { database, logger: false });
    const url = await server.listen();
    const sockets: Socket[] = [];

    return {
        url,
        server,
        database,
        config,
        createProject: (id, input) => server.projects.create(id, input),
        async request(project, method, path, body, options = {}) {
            const text = body === undefined ? '' : JSON.stringify(body);
            const signature = signRequest(
                options.secret ?? project.secret,
                { method, path, body: text },
                options.timestamp,
            );
            return fetch(`${url}${path}`, {
                method,
                headers: {
                    'Pingpong-Key': project.project.key,
                    'Pingpong-Signature': signature,
                    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                },
                ...(body === undefined ? {} : { body: text }),
            });
        },
        connect(project, key, options = {}) {
            const id = typeof project === 'string' ? project : project.project.id;
            const socket = io(`${url}/projects/${id}`, {
                auth: { key: key ?? (typeof project === 'string' ? '' : project.project.key) },
                forceNew: true,
                reconnectionDelay: 50,
                reconnectionDelayMax: 100,
                ...options,
            });
            sockets.push(socket);
            return socket;
        },
        async close() {
            sockets.forEach((socket) => socket.disconnect());
            await server.close();
            await database.close();
        },
    };
}

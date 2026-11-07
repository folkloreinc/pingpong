import type { SocketConnectError } from '@pingpong-io/protocol';

/** What the server counted for a project since it started, without what it reads live. */
export interface ProjectCounters {
    peakConnections: number;
    connectionsRefused: Partial<Record<SocketConnectError, number>>;
    messages: number;
    bytes: number;
    rateLimited: number;
}

/**
 * Counters per project, in memory, since the server started (decision 0009). Each server counts
 * its own: a restart starts them again. Usage kept per day is for later.
 */
export class ProjectStats {
    readonly since: Date;
    readonly #projects = new Map<string, ProjectCounters>();

    constructor(now = new Date()) {
        this.since = now;
    }

    #counters(projectId: string): ProjectCounters {
        let counters = this.#projects.get(projectId);
        if (counters === undefined) {
            counters = {
                peakConnections: 0,
                connectionsRefused: {},
                messages: 0,
                bytes: 0,
                rateLimited: 0,
            };
            this.#projects.set(projectId, counters);
        }
        return counters;
    }

    /** A copy of a project's counters: zeros for a project nothing happened to. */
    get(projectId: string): ProjectCounters {
        const counters = this.#counters(projectId);
        return { ...counters, connectionsRefused: { ...counters.connectionsRefused } };
    }

    connected(projectId: string, connections: number): void {
        const counters = this.#counters(projectId);
        counters.peakConnections = Math.max(counters.peakConnections, connections);
    }

    refused(projectId: string, reason: SocketConnectError): void {
        const refused = this.#counters(projectId).connectionsRefused;
        refused[reason] = (refused[reason] ?? 0) + 1;
    }

    published(projectId: string, messages: number, bytes: number): void {
        const counters = this.#counters(projectId);
        counters.messages += messages;
        counters.bytes += bytes;
    }

    rateLimited(projectId: string): void {
        this.#counters(projectId).rateLimited += 1;
    }

    /** Forgets a deleted project. */
    forget(projectId: string): void {
        this.#projects.delete(projectId);
    }
}

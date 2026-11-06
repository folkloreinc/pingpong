import type { Project, Projects } from './projects.ts';

interface Entry {
    project: Project | undefined;
    expiresAt: number;
}

/**
 * Projects read from the database at most once per `ttl` milliseconds, by id and by key. A change
 * made by this process (`invalidate()`) shows at once; one made by the CLI or another server shows
 * within `ttl`.
 */
export class ProjectCache {
    readonly #projects: Projects;
    readonly #ttl: number;
    readonly #byId = new Map<string, Entry>();
    readonly #byKey = new Map<string, Entry>();

    constructor(projects: Projects, ttl: number) {
        this.#projects = projects;
        this.#ttl = ttl;
    }

    async #read(
        map: Map<string, Entry>,
        lookup: string,
        load: () => Promise<Project | undefined>,
    ): Promise<Project | undefined> {
        const entry = map.get(lookup);
        if (entry !== undefined && entry.expiresAt > Date.now()) {
            return entry.project;
        }
        const project = await load();
        map.set(lookup, { project, expiresAt: Date.now() + this.#ttl });
        return project;
    }

    find(id: string): Promise<Project | undefined> {
        return this.#read(this.#byId, id, () => this.#projects.find(id));
    }

    findByKey(key: string): Promise<Project | undefined> {
        return this.#read(this.#byKey, key, () => this.#projects.findByKey(key));
    }

    invalidate(project: Pick<Project, 'id' | 'key'>): void {
        this.#byId.delete(project.id);
        this.#byKey.delete(project.key);
    }
}

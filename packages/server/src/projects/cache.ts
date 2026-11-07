import type { Project, Projects } from './projects.ts';

interface Entry {
    project: Project | undefined;
    expiresAt: number;
}

export interface ProjectCacheOptions {
    /**
     * The most entries kept by id, and as many by key. Ids and keys that match no project are
     * cached too, and anyone can try them: past this, the oldest entries go.
     */
    maxEntries?: number;
}

/**
 * Projects read from the database at most once per `ttl` milliseconds, by id and by key. A change
 * made by this process (`invalidate()`) shows at once; one made by the CLI or another server shows
 * within `ttl`.
 */
export class ProjectCache {
    readonly #projects: Projects;
    readonly #ttl: number;
    readonly #maxEntries: number;
    readonly #byId = new Map<string, Entry>();
    readonly #byKey = new Map<string, Entry>();

    constructor(
        projects: Projects,
        ttl: number,
        { maxEntries = 10_000 }: ProjectCacheOptions = {},
    ) {
        this.#projects = projects;
        this.#ttl = ttl;
        this.#maxEntries = maxEntries;
    }

    /** The entries kept, by id and by key. */
    get size(): number {
        return this.#byId.size + this.#byKey.size;
    }

    /** Keeps an entry, last in the map's order, then drops expired entries and the oldest ones. */
    #set(map: Map<string, Entry>, lookup: string, entry: Entry): void {
        map.delete(lookup);
        map.set(lookup, entry);
        if (map.size <= this.#maxEntries) {
            return;
        }
        const now = Date.now();
        for (const [key, { expiresAt }] of map) {
            if (expiresAt <= now) {
                map.delete(key);
            }
        }
        for (const key of map.keys()) {
            if (map.size <= this.#maxEntries) {
                break;
            }
            map.delete(key);
        }
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
        this.#set(map, lookup, { project, expiresAt: Date.now() + this.#ttl });
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

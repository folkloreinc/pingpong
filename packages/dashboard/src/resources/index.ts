import type { ResourceHandler } from '../adapter/adapter.ts';
import { projects } from './projects.ts';

/** The resources of the definition, on the admin API. */
export function createResources(): Record<string, ResourceHandler> {
    return { projects };
}

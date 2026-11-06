import { basename } from 'node:path';
import { defineConfig } from 'vitest/config';
import type { ViteUserConfig } from 'vitest/config';

/**
 * Shared Vitest config of the packages and spikes. Imports between packages resolve to their
 * TypeScript sources (the `@pingpong-io/source` export condition), so tests don't need a build.
 */
export function definePackageConfig(root: string): ViteUserConfig {
    return defineConfig({
        root,
        resolve: {
            conditions: ['@pingpong-io/source'],
        },
        ssr: {
            resolve: {
                conditions: ['@pingpong-io/source'],
            },
        },
        test: {
            name: basename(root),
            environment: 'node',
            include: ['src/**/*.test.ts'],
            passWithNoTests: true,
        },
    });
}

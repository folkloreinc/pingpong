import { readFileSync } from 'node:fs';

/** The server's version, from its package.json (one level up, from `src/` and from `dist/`). */
export const VERSION = (
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
        version: string;
    }
).version;

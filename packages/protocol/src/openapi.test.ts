import { validate as validateOpenApi } from '@readme/openapi-parser';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { generate } from '../scripts/generate.ts';
import { jsonSchema, openapi } from './index.ts';

function collectRefs(value: unknown, refs = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
        value.forEach((item) => collectRefs(item, refs));
    } else if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            if (key === '$ref' && typeof child === 'string') {
                refs.add(child);
            } else {
                collectRefs(child, refs);
            }
        }
    }
    return refs;
}

function resolvePointer(document: unknown, ref: string): unknown {
    return ref
        .slice(2)
        .split('/')
        .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
        .reduce<unknown>(
            (node, token) =>
                node !== null && typeof node === 'object'
                    ? (node as Record<string, unknown>)[token]
                    : undefined,
            document,
        );
}

describe('OpenAPI document', () => {
    it('is a valid OpenAPI 3.1 document', async () => {
        const result = await validateOpenApi(structuredClone(openapi) as never);
        expect(result.valid ? [] : result.errors).toEqual([]);
    });

    it('only references what it defines', () => {
        const missing = [...collectRefs(openapi)].filter(
            (ref) => !ref.startsWith('#/') || resolvePointer(openapi, ref) === undefined,
        );
        expect(missing).toEqual([]);
    });

    it('describes the v1 API and the admin API', () => {
        expect(Object.keys(openapi.paths)).toEqual([
            '/v1/messages',
            '/v1/messages/batch',
            '/v1/channels/{channel}',
            '/v1/origins',
            '/health',
            '/admin/v1/status',
            '/admin/v1/projects',
            '/admin/v1/projects/{project}',
            '/admin/v1/projects/{project}/rotate-secret',
            '/admin/v1/projects/{project}/channels',
            '/admin/v1/projects/{project}/channels/{channel}',
        ]);
    });

    it('signs every v1 request, and needs the admin token for the admin API', () => {
        for (const [path, item] of Object.entries(openapi.paths)) {
            for (const [method, operation] of Object.entries(item)) {
                if (method === 'parameters') {
                    continue;
                }
                expect((operation as { security?: unknown }).security, `${method} ${path}`).toEqual(
                    path.startsWith('/v1/')
                        ? [{ projectKey: [], requestSignature: [] }]
                        : path.startsWith('/admin/v1/')
                          ? [{ adminToken: [] }]
                          : [],
                );
            }
        }
    });

    it('answers errors as problem details', () => {
        const responses = Object.values(openapi.paths)
            .flatMap((item) => Object.values(item))
            .flatMap((operation) =>
                operation !== null && typeof operation === 'object' && 'responses' in operation
                    ? Object.entries(operation.responses as Record<string, { $ref?: string }>)
                    : [],
            )
            .filter(([status]) => Number(status) >= 400);
        expect(responses.length).toBeGreaterThan(0);
        for (const [status, response] of responses) {
            const resolved = (
                response.$ref !== undefined ? resolvePointer(openapi, response.$ref) : response
            ) as { content?: Record<string, unknown> };
            expect(Object.keys(resolved.content ?? {}), status).toEqual([
                'application/problem+json',
            ]);
        }
    });
});

describe('generated files', () => {
    it('are up to date (run `npm run generate -w @pingpong-io/protocol`)', async () => {
        for (const [path, content] of Object.entries(await generate())) {
            const current = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
            expect(current === content, path).toBe(true);
        }
    });

    it('bundle every schema as a JSON Schema definition', () => {
        expect(Object.keys(jsonSchema['$defs'] as object)).toEqual(
            Object.keys(openapi.components.schemas),
        );
        expect([...collectRefs(jsonSchema)].filter((ref) => !ref.startsWith('#/$defs/'))).toEqual(
            [],
        );
    });
});

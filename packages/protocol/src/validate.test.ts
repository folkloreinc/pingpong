import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { toProblemErrors, validate } from './index.ts';
import type { SchemaName } from './index.ts';

/** The JSON code blocks of a Markdown file of the repository, in order. */
function readJsonExamples(path: string): unknown[] {
    const markdown = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
    return [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map(([, json]) =>
        JSON.parse(json ?? ''),
    );
}

/** The pointers of the errors, once each. */
function pointers(name: SchemaName, value: unknown): string[] {
    const result = validate(name, value);
    return result.valid ? [] : [...new Set(result.errors.map((error) => error.pointer))];
}

describe('the examples of docs/protocol.md', () => {
    it('validate', () => {
        const [
            publish,
            channel,
            origins,
            connected,
            subscribe,
            message,
            count,
            create,
            patch,
            stats,
            ...others
        ] = readJsonExamples('docs/protocol.md');
        expect(others).toEqual([]);
        expect(validate('PublishRequest', publish)).toMatchObject({ valid: true });
        expect(validate('Channel', channel)).toMatchObject({ valid: true });
        expect(validate('Origins', origins)).toMatchObject({ valid: true });
        expect(validate('SocketConnected', connected)).toMatchObject({ valid: true });
        expect(validate('SocketSubscribeRequest', subscribe)).toMatchObject({ valid: true });
        expect(validate('SocketMessage', message)).toMatchObject({ valid: true });
        expect(validate('SocketSubscriptionCount', count)).toMatchObject({ valid: true });
        expect(validate('AdminProjectCreate', create)).toMatchObject({ valid: true });
        expect(validate('AdminProjectPatch', patch)).toMatchObject({ valid: true });
        expect(validate('ProjectStats', stats)).toMatchObject({ valid: true });
    });
});

describe('PublishRequest', () => {
    const message = { channels: ['comments.article-1'], event: 'comment.created' };

    it('takes any JSON as data, or none', () => {
        for (const data of [undefined, null, 0, 'text', [1, 2], { nested: { a: true } }]) {
            expect(pointers('PublishRequest', { ...message, data })).toEqual([]);
        }
    });

    it("takes Laravel's default event names", () => {
        expect(
            pointers('PublishRequest', { ...message, event: 'App\\Events\\CommentCreated' }),
        ).toEqual([]);
    });

    it('refuses unknown fields, and bad channels and events', () => {
        expect(pointers('PublishRequest', { ...message, chanel: 'x' })).toEqual(['/chanel']);
        expect(pointers('PublishRequest', { ...message, channels: [] })).toEqual(['/channels']);
        expect(pointers('PublishRequest', { ...message, channels: ['a b'] })).toEqual([
            '/channels/0',
        ]);
        expect(pointers('PublishRequest', { ...message, channels: ['a', 'a'] })).toEqual([
            '/channels',
        ]);
        expect(pointers('PublishRequest', { ...message, event: 'with space' })).toEqual(['/event']);
        expect(pointers('PublishRequest', { channels: ['a'] })).toEqual(['/event']);
    });

    it('limits the channels of a message, and the messages of a batch', () => {
        const channels = Array.from({ length: 101 }, (_, index) => `c${index}`);
        expect(pointers('PublishRequest', { ...message, channels })).toEqual(['/channels']);
        const messages = Array.from({ length: 101 }, () => message);
        expect(pointers('PublishBatchRequest', { messages })).toEqual(['/messages']);
        expect(pointers('PublishBatchRequest', { messages: [message, { event: 'x' }] })).toEqual([
            '/messages/1/channels',
        ]);
    });
});

describe('ChannelName', () => {
    it('takes the names Laravel apps use', () => {
        for (const channel of [
            'comments.article-1',
            'private-users.42',
            'presence-room.7',
            'game.01HZX3.fr',
            'a=b@c,d;e:f',
        ]) {
            expect(pointers('ChannelName', channel), channel).toEqual([]);
        }
    });

    it('refuses spaces, slashes and long names', () => {
        for (const channel of ['', 'a b', 'a/b', 'é', 'x'.repeat(201)]) {
            expect(pointers('ChannelName', channel), channel).toEqual(['']);
        }
    });
});

describe('Origin', () => {
    it('takes origins and subdomain wildcards', () => {
        for (const origin of [
            'https://example.com',
            'http://localhost:3000',
            'https://*.example.com',
            'https://contest.example.co.uk',
        ]) {
            expect(pointers('Origin', origin), origin).toEqual([]);
        }
    });

    it('refuses paths, other schemes, upper case and bare wildcards', () => {
        for (const origin of [
            'https://example.com/',
            'https://example.com/path',
            'ftp://example.com',
            'example.com',
            'https://Example.com',
            'https://*',
            'https://a.*.example.com',
        ]) {
            expect(pointers('Origin', origin), origin).toEqual(['']);
        }
    });
});

describe('SocketSubscribeResult', () => {
    it('is a success with a count, or an error', () => {
        expect(pointers('SocketSubscribeResult', { ok: true, subscriptionCount: 1 })).toEqual([]);
        expect(
            pointers('SocketSubscribeResult', { ok: false, error: 'invalid_signature' }),
        ).toEqual([]);
        expect(validate('SocketSubscribeResult', { ok: false, error: 'nope' }).valid).toBe(false);
    });
});

describe('AdminProjectCreate', () => {
    it('needs an id, and takes a name, origins, limits and a status', () => {
        expect(pointers('AdminProjectCreate', { id: 'my-app' })).toEqual([]);
        expect(
            pointers('AdminProjectCreate', {
                id: 'my-app',
                name: 'My app',
                origins: ['https://example.com', 'https://*.example.com'],
                limits: { maxConnections: 500, maxMessageSize: null },
                disabled: true,
            }),
        ).toEqual([]);
        expect(pointers('AdminProjectCreate', {})).toEqual(['/id']);
    });

    it('refuses bad ids, origins and limits, and unknown fields', () => {
        expect(
            pointers('AdminProjectCreate', {
                id: 'My App',
                origins: ['https://example.com/path'],
                limits: { maxConnections: 0, maxSockets: 1 },
                key: 'pk_mine',
            }).sort(),
        ).toEqual(['/id', '/key', '/limits/maxConnections', '/limits/maxSockets', '/origins/0']);
    });
});

describe('AdminProjectPatch', () => {
    it('changes at least one thing', () => {
        expect(pointers('AdminProjectPatch', { disabled: false })).toEqual([]);
        expect(pointers('AdminProjectPatch', { origins: [] })).toEqual([]);
        expect(validate('AdminProjectPatch', {}).valid).toBe(false);
    });

    it("doesn't change the id or the key", () => {
        expect(pointers('AdminProjectPatch', { id: 'other', key: 'pk_x' })).toEqual([
            '/id',
            '/key',
        ]);
    });
});

describe('AdminSecretRotation', () => {
    it('takes a grace period in seconds, up to 30 days', () => {
        expect(pointers('AdminSecretRotation', {})).toEqual([]);
        expect(pointers('AdminSecretRotation', { gracePeriod: 0 })).toEqual([]);
        expect(pointers('AdminSecretRotation', { gracePeriod: -1 })).toEqual(['/gracePeriod']);
        expect(pointers('AdminSecretRotation', { gracePeriod: 2_592_001 })).toEqual([
            '/gracePeriod',
        ]);
    });
});

describe('toProblemErrors', () => {
    it('groups messages by pointer', () => {
        const result = validate('PublishRequest', { channels: ['a b', 'c d'], extra: 1 });
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(Object.keys(toProblemErrors(result.errors)).sort()).toEqual([
                '/channels/0',
                '/channels/1',
                '/event',
                '/extra',
            ]);
        }
    });
});

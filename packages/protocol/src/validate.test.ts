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
        const [publish, channel, origins, connected, subscribe, message, count, ...others] =
            readJsonExamples('docs/protocol.md');
        expect(others).toEqual([]);
        expect(validate('PublishRequest', publish)).toMatchObject({ valid: true });
        expect(validate('Channel', channel)).toMatchObject({ valid: true });
        expect(validate('Origins', origins)).toMatchObject({ valid: true });
        expect(validate('SocketConnected', connected)).toMatchObject({ valid: true });
        expect(validate('SocketSubscribeRequest', subscribe)).toMatchObject({ valid: true });
        expect(validate('SocketMessage', message)).toMatchObject({ valid: true });
        expect(validate('SocketSubscriptionCount', count)).toMatchObject({ valid: true });
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

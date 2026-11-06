import { describe, expect, it } from 'vitest';

import { laravelAuthorizer } from './index.ts';

describe('laravelAuthorizer', () => {
    it("posts the socket and the channel to the application's route, and reads the signature", async () => {
        const requests: { url: string; init: RequestInit }[] = [];
        const authorize = laravelAuthorizer({
            endpoint: '/pingpong/auth',
            headers: { 'X-CSRF-TOKEN': 'token' },
            fetch: async (url, init) => {
                requests.push({ url: String(url), init: init ?? {} });
                return new Response(JSON.stringify({ signature: 'abc' }), { status: 200 });
            },
        });
        expect(await authorize({ socketId: 'socket', channel: 'private-users.42' })).toBe('abc');
        expect(requests[0]?.url).toBe('/pingpong/auth');
        expect(requests[0]?.init).toMatchObject({
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRF-TOKEN': 'token', 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
            socket_id: 'socket',
            channel_name: 'private-users.42',
        });
    });

    it('throws when the application refuses or answers without a signature', async () => {
        const refusing = laravelAuthorizer({
            fetch: async () => new Response('', { status: 403 }),
        });
        await expect(refusing({ socketId: 's', channel: 'private-a' })).rejects.toThrow(/403/);
        const empty = laravelAuthorizer({ fetch: async () => new Response('{}', { status: 200 }) });
        await expect(empty({ socketId: 's', channel: 'private-a' })).rejects.toThrow(
            /no signature/,
        );
    });
});

import { execFileSync } from 'node:child_process';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectMessages, connectClient, connected, subscribe, waitUntil } from './client.ts';
import { startSpikeServer } from './server.ts';
import type { SpikeServer } from './server.ts';
import { signChannel, verifyChannelSignature } from './signature.ts';

const project = { id: 'alpha', key: 'alpha-key', secret: 'alpha-secret', origins: [] };

function hasPhp(): boolean {
    try {
        execFileSync('php', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/** What the Laravel broadcaster will compute, in PHP. */
function signInPhp(secret: string, socketId: string, channel: string): string {
    return execFileSync('php', [
        '-r',
        'echo hash_hmac("sha256", $argv[1].":".$argv[2], $argv[3]);',
        socketId,
        channel,
        secret,
    ]).toString();
}

describe('channel signatures', () => {
    it.runIf(hasPhp())('match the signature PHP computes', () => {
        const socketId = 'Xk2cHvB1mLqQ9a8cAAAB';
        expect(signInPhp('alpha-secret', socketId, 'private-users.42')).toBe(
            signChannel('alpha-secret', socketId, 'private-users.42'),
        );
    });

    it('refuses malformed signatures without throwing', () => {
        for (const signature of [undefined, null, 42, '', 'abc', 'g'.repeat(64)]) {
            expect(verifyChannelSignature('s', 'id', 'private-a', signature)).toBe(false);
        }
    });
});

describe('private channels', () => {
    let server: SpikeServer;
    let socket: Socket;

    beforeEach(async () => {
        server = await startSpikeServer([project]);
        socket = connectClient(server.url, 'alpha', 'alpha-key');
        await connected(socket);
    });

    afterEach(async () => {
        socket.disconnect();
        await server.close();
    });

    it('lets anyone join a public channel', async () => {
        await expect(subscribe(socket, { channel: 'comments.article-1' })).resolves.toEqual({
            ok: true,
        });
    });

    it('needs the signature of this socket, with the project secret', async () => {
        const channel = 'private-users.42';
        const id = socket.id as string;
        const refused = { ok: false, error: 'invalid_signature' };

        expect(await subscribe(socket, { channel })).toEqual(refused);
        expect(
            await subscribe(socket, { channel, signature: signChannel('wrong', id, channel) }),
        ).toEqual(refused);
        expect(
            await subscribe(socket, {
                channel,
                signature: signChannel(project.secret, 'another-socket', channel),
            }),
        ).toEqual(refused);
        expect(
            await subscribe(socket, {
                channel: 'private-users.43',
                signature: signChannel(project.secret, id, channel),
            }),
        ).toEqual(refused);

        const signature = hasPhp()
            ? signInPhp(project.secret, id, channel)
            : signChannel(project.secret, id, channel);
        expect(await subscribe(socket, { channel, signature })).toEqual({ ok: true });

        const messages = collectMessages(socket);
        server.publish('alpha', { channel, event: 'notification', data: { id: 7 } });
        await waitUntil(() => messages.length === 1);
        expect(messages[0]).toEqual({ channel, event: 'notification', data: { id: 7 } });
    });
});

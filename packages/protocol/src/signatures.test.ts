import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
    parseSignatureHeader,
    signChannel,
    signRequest,
    verifyChannelSignature,
    verifyRequestSignature,
} from './signatures.ts';

function hasPhp(): boolean {
    try {
        execFileSync('php', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function php(code: string, ...args: string[]): string {
    return execFileSync('php', ['-r', code, ...args]).toString();
}

const secret = 'sk_current';
const previous = 'sk_previous';
const request = { method: 'post', path: '/v1/messages', body: '{"channels":["a"],"event":"e"}' };
const now = 1_800_000_000;

describe('channel signatures', () => {
    it.runIf(hasPhp())('match what PHP computes', () => {
        expect(
            php(
                'echo hash_hmac("sha256", $argv[1].":".$argv[2], $argv[3]);',
                'Xk2cHvB1mLqQ9a8cAAAB',
                'private-users.42',
                secret,
            ),
        ).toBe(signChannel(secret, 'Xk2cHvB1mLqQ9a8cAAAB', 'private-users.42'));
    });

    it('are valid with the current or the previous secret, for that socket and channel', () => {
        const signature = signChannel(previous, 'socket', 'private-a');
        expect(verifyChannelSignature([secret, previous], 'socket', 'private-a', signature)).toBe(
            true,
        );
        expect(verifyChannelSignature([secret], 'socket', 'private-a', signature)).toBe(false);
        expect(verifyChannelSignature([previous], 'other', 'private-a', signature)).toBe(false);
        expect(verifyChannelSignature([previous], 'socket', 'private-b', signature)).toBe(false);
    });

    it('refuse what is not a signature, without throwing', () => {
        for (const signature of [undefined, null, 42, '', 'abc', 'G'.repeat(64), 'A'.repeat(64)]) {
            expect(verifyChannelSignature([secret], 'socket', 'private-a', signature)).toBe(false);
        }
    });
});

describe('request signatures', () => {
    it.runIf(hasPhp())('match what PHP computes', () => {
        const header = signRequest(secret, request, now);
        const value = php(
            'echo hash_hmac("sha256", $argv[1].".POST./v1/messages.".hash("sha256", $argv[2]), $argv[3]);',
            String(now),
            request.body,
            secret,
        );
        expect(header).toBe(`t=${now},v1=${value}`);
    });

    it('cover the timestamp, the method, the path and the body', () => {
        const header = signRequest(secret, request, now);
        const bodyHash = createHash('sha256').update(request.body).digest('hex');
        expect(parseSignatureHeader(header)?.timestamp).toBe(now);
        expect(verifyRequestSignature([secret], header, request, now)).toEqual({ valid: true });
        for (const changed of [
            { ...request, method: 'PUT' },
            { ...request, path: '/v1/messages/batch' },
            { ...request, body: `${request.body} ` },
        ]) {
            expect(verifyRequestSignature([secret], header, changed, now)).toEqual({
                valid: false,
                reason: 'mismatch',
            });
        }
        expect(bodyHash).toHaveLength(64);
    });

    it('sign an empty body like a missing one', () => {
        const get = { method: 'GET', path: '/v1/origins' };
        expect(signRequest(secret, get, now)).toBe(signRequest(secret, { ...get, body: '' }, now));
    });

    it('expire after five minutes, either way', () => {
        const header = signRequest(secret, request, now);
        expect(verifyRequestSignature([secret], header, request, now + 300).valid).toBe(true);
        expect(verifyRequestSignature([secret], header, request, now + 301)).toEqual({
            valid: false,
            reason: 'expired',
        });
        expect(verifyRequestSignature([secret], header, request, now - 301).valid).toBe(false);
    });

    it('carry one value per secret during a rotation', () => {
        const header = signRequest([secret, previous], request, now);
        expect(parseSignatureHeader(header)?.signatures).toHaveLength(2);
        expect(verifyRequestSignature([previous], header, request, now).valid).toBe(true);
        expect(verifyRequestSignature(['sk_other'], header, request, now).valid).toBe(false);
    });

    it('refuse a malformed header', () => {
        for (const header of [undefined, '', 't=1', 'v1=abc', `t=x,v1=${'a'.repeat(64)}`]) {
            expect(verifyRequestSignature([secret], header, request, now)).toEqual({
                valid: false,
                reason: 'malformed',
            });
        }
    });
});

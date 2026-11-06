import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, randomToken, safeEqual } from './crypto.ts';

describe('secrets at rest', () => {
    const key = Buffer.alloc(32, 1);

    it('decrypt with the key they were encrypted with', () => {
        const encrypted = encryptSecret(key, 'sk_secret');
        expect(encrypted).not.toContain('sk_secret');
        expect(encrypted).not.toBe(encryptSecret(key, 'sk_secret'));
        expect(decryptSecret(key, encrypted)).toBe('sk_secret');
    });

    it("don't decrypt with another key, and say why without the value", () => {
        const encrypted = encryptSecret(key, 'sk_secret');
        expect(() => decryptSecret(Buffer.alloc(32, 2), encrypted)).toThrow(/PINGPONG_SECRET_KEY/);
    });
});

describe('tokens', () => {
    it('are prefixed and random', () => {
        expect(randomToken('pk_', 18)).toMatch(/^pk_[A-Za-z0-9_-]{24}$/);
        expect(randomToken('sk_')).not.toBe(randomToken('sk_'));
        expect(safeEqual('a', 'a')).toBe(true);
        expect(safeEqual('a', 'ab')).toBe(false);
    });
});

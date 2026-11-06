import { describe, expect, it } from 'vitest';

import { isOriginAllowed } from './origins.ts';

describe('isOriginAllowed', () => {
    const origins = ['https://example.com', 'https://*.contest.test', 'http://localhost:3000'];

    it('matches exact origins, in any case', () => {
        expect(isOriginAllowed(origins, 'https://example.com')).toBe(true);
        expect(isOriginAllowed(origins, 'https://EXAMPLE.com')).toBe(true);
        expect(isOriginAllowed(origins, 'http://localhost:3000')).toBe(true);
        expect(isOriginAllowed(origins, 'http://example.com')).toBe(false);
        expect(isOriginAllowed(origins, 'https://example.com:8443')).toBe(false);
        expect(isOriginAllowed(origins, 'http://localhost:3001')).toBe(false);
    });

    it('matches subdomains of a wildcard, not the domain itself', () => {
        expect(isOriginAllowed(origins, 'https://a.contest.test')).toBe(true);
        expect(isOriginAllowed(origins, 'https://a.b.contest.test')).toBe(true);
        expect(isOriginAllowed(origins, 'https://contest.test')).toBe(false);
        expect(isOriginAllowed(origins, 'https://evilcontest.test')).toBe(false);
        expect(isOriginAllowed(origins, 'https://a.contest.test.evil.com')).toBe(false);
        expect(isOriginAllowed(origins, 'http://a.contest.test')).toBe(false);
        expect(isOriginAllowed(origins, 'https://a.contest.test:444')).toBe(false);
    });

    it('allows nothing without origins', () => {
        expect(isOriginAllowed([], 'https://example.com')).toBe(false);
    });
});

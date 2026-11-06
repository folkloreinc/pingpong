import { describe, expect, it } from 'vitest';

import { JSON_SCHEMA_ID, PROTOCOL_VERSION } from './index.ts';

describe('PROTOCOL_VERSION', () => {
    it('is v1', () => {
        expect(PROTOCOL_VERSION).toBe('v1');
        expect(JSON_SCHEMA_ID).toBe('urn:pingpong:protocol:v1');
    });
});

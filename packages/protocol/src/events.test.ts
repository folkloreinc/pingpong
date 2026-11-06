import { describe, expect, it } from 'vitest';

import { isPresenceChannel, isPrivateChannel, projectNamespace } from './index.ts';

describe('channels', () => {
    it('are private when they start with private- or presence-', () => {
        expect(isPrivateChannel('private-users.42')).toBe(true);
        expect(isPrivateChannel('presence-room.1')).toBe(true);
        expect(isPrivateChannel('comments.private-1')).toBe(false);
        expect(isPresenceChannel('presence-room.1')).toBe(true);
        expect(isPresenceChannel('private-users.42')).toBe(false);
    });

    it('live in the namespace of their project', () => {
        expect(projectNamespace('my-app')).toBe('/projects/my-app');
    });
});

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether an `Origin` header is one of a project's origins. An origin matches exactly, or through
 * a wildcard: `https://*.example.com` matches `https://a.example.com` and `https://a.b.example.com`,
 * with the same scheme and port, but not `https://example.com`.
 */
export function isOriginAllowed(origins: readonly string[], origin: string): boolean {
    const candidate = origin.toLowerCase();
    return origins.some((allowed) => {
        const wildcard = /^(https?:\/\/)\*\.(.+)$/.exec(allowed);
        if (wildcard === null) {
            return allowed === candidate;
        }
        const [, scheme = '', suffix = ''] = wildcard;
        return new RegExp(
            `^${escapeRegExp(scheme)}[a-z0-9-]+(\\.[a-z0-9-]+)*\\.${escapeRegExp(suffix)}$`,
        ).test(candidate);
    });
}

import type { Authorizer } from './client.ts';

export interface LaravelAuthorizerOptions {
    /** The route of `folklore/laravel-pingpong` that signs channels. */
    endpoint?: string;
    /** Extra headers, such as `X-CSRF-TOKEN` or `Authorization: Bearer …`. */
    headers?: Record<string, string>;
    /** Sends the session cookie: `same-origin` by default, `include` for another domain. */
    credentials?: RequestCredentials;
    fetch?: typeof fetch;
}

/** Reads the `XSRF-TOKEN` cookie that Laravel sets, in a browser. */
function xsrfToken(): string | undefined {
    if (typeof document === 'undefined') {
        return undefined;
    }
    const match = /(?:^|;\s*)XSRF-TOKEN=([^;]*)/.exec(document.cookie);
    return match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
}

/**
 * Asks a Laravel application for the signature of a private channel, through the route of
 * `folklore/laravel-pingpong`: it checks `routes/channels.php` with the user's session or token,
 * and answers `{ "signature": "…" }`.
 */
export function laravelAuthorizer(options: LaravelAuthorizerOptions = {}): Authorizer {
    const { endpoint = '/broadcasting/auth', headers = {}, credentials = 'same-origin' } = options;
    return async ({ socketId, channel }) => {
        const token = xsrfToken();
        const response = await (options.fetch ?? fetch)(endpoint, {
            method: 'POST',
            credentials,
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...(token === undefined ? {} : { 'X-XSRF-TOKEN': token }),
                ...headers,
            },
            body: JSON.stringify({ socket_id: socketId, channel_name: channel }),
        });
        if (!response.ok) {
            throw new Error(`The application refused the channel ${channel} (${response.status}).`);
        }
        const body = (await response.json()) as { signature?: unknown };
        if (typeof body.signature !== 'string') {
            throw new Error(`The application gave no signature for the channel ${channel}.`);
        }
        return body.signature;
    };
}

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** How far a request's timestamp may be from the server's clock, in seconds. */
export const SIGNATURE_TOLERANCE = 300;

/** The header that names the project of an API request. */
export const KEY_HEADER = 'Pingpong-Key';

/** The header that carries an API request's signature. */
export const SIGNATURE_HEADER = 'Pingpong-Signature';

const HEX_SIGNATURE = /^[0-9a-f]{64}$/;

function hmac(secret: string, subject: string): string {
    return createHmac('sha256', secret).update(subject).digest('hex');
}

function sameHex(a: string, b: string): boolean {
    return a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * The signature an application gives a client to join a private channel: the hex HMAC-SHA256 of
 * `{socketId}:{channel}` with the project's secret. In PHP:
 * `hash_hmac('sha256', "$socketId:$channel", $secret)`.
 */
export function signChannel(secret: string, socketId: string, channel: string): string {
    return hmac(secret, `${socketId}:${channel}`);
}

/**
 * Checks a channel signature against the project's secrets: the current one and, during the grace
 * period of a rotation, the previous one. Refuses anything that is not a signature, without
 * throwing.
 */
export function verifyChannelSignature(
    secrets: readonly string[],
    socketId: string,
    channel: string,
    signature: unknown,
): boolean {
    if (typeof signature !== 'string' || !HEX_SIGNATURE.test(signature)) {
        return false;
    }
    return secrets.some((secret) => sameHex(signChannel(secret, socketId, channel), signature));
}

export interface SignedRequest {
    /** The HTTP method, in any case. */
    method: string;
    /** The request target as sent: path and query string, without the host. */
    path: string;
    /** The raw body, or nothing for a request without one. */
    body?: string | Uint8Array;
}

function requestSubject(timestamp: number, { method, path, body }: SignedRequest): string {
    const bodyHash = createHash('sha256')
        .update(body ?? '')
        .digest('hex');
    return `${timestamp}.${method.toUpperCase()}.${path}.${bodyHash}`;
}

/**
 * The `Pingpong-Signature` header of an API request: `t=<unix time>,v1=<hex HMAC-SHA256>`, with one
 * `v1` value per secret.
 */
export function signRequest(
    secrets: string | readonly string[],
    request: SignedRequest,
    timestamp = Math.floor(Date.now() / 1000),
): string {
    const subject = requestSubject(timestamp, request);
    const values = (typeof secrets === 'string' ? [secrets] : secrets).map(
        (secret) => `v1=${hmac(secret, subject)}`,
    );
    return [`t=${timestamp}`, ...values].join(',');
}

export type RequestVerification =
    { valid: true } | { valid: false; reason: 'malformed' | 'expired' | 'mismatch' };

/** Reads a `Pingpong-Signature` header. Returns null when it is not one. */
export function parseSignatureHeader(
    header: unknown,
): { timestamp: number; signatures: string[] } | null {
    if (typeof header !== 'string' || !/^t=[0-9]+(,v1=[0-9a-f]{64})+$/.test(header)) {
        return null;
    }
    const [timestamp, ...values] = header.split(',');
    return {
        timestamp: Number(timestamp?.slice(2)),
        signatures: values.map((value) => value.slice(3)),
    };
}

/**
 * Checks an API request's signature against the project's secrets. The request is valid when its
 * timestamp is within `SIGNATURE_TOLERANCE` of `now` and one of its `v1` values matches one of the
 * secrets.
 */
export function verifyRequestSignature(
    secrets: readonly string[],
    header: unknown,
    request: SignedRequest,
    now = Math.floor(Date.now() / 1000),
): RequestVerification {
    const parsed = parseSignatureHeader(header);
    if (parsed === null) {
        return { valid: false, reason: 'malformed' };
    }
    if (Math.abs(now - parsed.timestamp) > SIGNATURE_TOLERANCE) {
        return { valid: false, reason: 'expired' };
    }
    const subject = requestSubject(parsed.timestamp, request);
    const matches = secrets.some((secret) => {
        const expected = hmac(secret, subject);
        return parsed.signatures.some((signature) => sameHex(expected, signature));
    });
    return matches ? { valid: true } : { valid: false, reason: 'mismatch' };
}

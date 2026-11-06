import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The signature an application gives a client to join a private or presence channel: an
 * HMAC-SHA256 of `socketId:channel` (and `:channelData` for a presence channel) with the
 * project's secret, in lowercase hex. PHP computes it with
 * `hash_hmac('sha256', "$socketId:$channel", $secret)`.
 */
export function signChannel(
    secret: string,
    socketId: string,
    channel: string,
    channelData?: string,
): string {
    const subject = [socketId, channel, ...(channelData === undefined ? [] : [channelData])].join(
        ':',
    );
    return createHmac('sha256', secret).update(subject).digest('hex');
}

export function verifyChannelSignature(
    secret: string,
    socketId: string,
    channel: string,
    signature: unknown,
    channelData?: string,
): boolean {
    if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)) {
        return false;
    }
    const expected = Buffer.from(signChannel(secret, socketId, channel, channelData), 'hex');
    return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export function isPrivateChannel(channel: string): boolean {
    return channel.startsWith('private-') || channel.startsWith('presence-');
}

interface Bucket {
    tokens: number;
    updatedAt: number;
}

/**
 * A token bucket per project: up to `rate` messages per second, with bursts of up to `rate`. It
 * counts the messages of this server: with several servers, each one allows the rate.
 */
export class RateLimiter {
    readonly #buckets = new Map<string, Bucket>();
    readonly #now: () => number;

    constructor(now = () => Date.now()) {
        this.#now = now;
    }

    /**
     * Takes `count` tokens from the project's bucket. Returns 0 when it could, or the seconds to wait
     * before it can.
     */
    take(projectId: string, count: number, rate: number): number {
        const now = this.#now();
        const bucket = this.#buckets.get(projectId) ?? { tokens: rate, updatedAt: now };
        bucket.tokens = Math.min(rate, bucket.tokens + ((now - bucket.updatedAt) / 1000) * rate);
        bucket.updatedAt = now;
        this.#buckets.set(projectId, bucket);
        // A batch of more than a second's worth waits for a full bucket, then overdraws it: the
        // requests that follow wait for it to fill again.
        const needed = Math.min(count, rate);
        if (bucket.tokens < needed) {
            return Math.max(1, Math.ceil((needed - bucket.tokens) / rate));
        }
        bucket.tokens -= count;
        return 0;
    }
}

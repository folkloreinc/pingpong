import type { Problem } from '@pingpong-io/protocol';

/** An error answered as problem details (RFC 9457). */
export class HttpProblem extends Error {
    readonly status: number;
    readonly title: string;
    readonly errors: Record<string, string[]> | undefined;
    readonly headers: Record<string, string>;

    constructor(
        status: number,
        title: string,
        detail?: string,
        {
            errors,
            headers = {},
        }: { errors?: Record<string, string[]>; headers?: Record<string, string> } = {},
    ) {
        super(detail ?? title);
        this.status = status;
        this.title = title;
        this.errors = errors;
        this.headers = headers;
    }

    toJSON(): Problem {
        return {
            type: 'about:blank',
            title: this.title,
            status: this.status,
            ...(this.message === this.title ? {} : { detail: this.message }),
            ...(this.errors === undefined ? {} : { errors: this.errors }),
        };
    }
}

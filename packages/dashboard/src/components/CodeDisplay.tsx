import type { DisplayProps } from '@panneau/lists';
import { EmptyValue } from '@panneau/lists';

/** A value as code: a project's id, its public key. */
export function CodeDisplay({ value }: DisplayProps) {
    if (value === null || value === undefined || value === '') {
        return <EmptyValue />;
    }
    return <code>{String(value)}</code>;
}

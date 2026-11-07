import type { Form } from '@panneau/core';
import { useDataAdapter } from '@panneau/data/query';
import { useFormState } from '@panneau/forms';
import { useQuery } from '@tanstack/react-query';

import type { AdminProject } from '@pingpong-io/protocol';

/** The id of the project of a form, for the components of its layout. */
export function useProjectId(form: Form): string | null {
    const { initialValues } = useFormState(form);
    const id = initialValues['id'];
    return typeof id === 'string' && id !== '' ? id : null;
}

export const projectQueryKey = (id: string | null) => ['pingpong', 'project', id];

/** The project, as the admin API has it now, with its live stats: read again every 5 seconds. */
export function useLiveProject(id: string | null) {
    const adapter = useDataAdapter();
    return useQuery({
        queryKey: projectQueryKey(id),
        queryFn: ({ signal }) =>
            adapter.getWidgetData(`project?id=${encodeURIComponent(id ?? '')}`, {
                signal,
            }) as Promise<AdminProject>,
        enabled: id !== null,
        refetchInterval: 5_000,
    });
}

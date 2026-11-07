import type { ClientActionProps } from '@panneau/actions';
import { useCreateItem } from '@panneau/data/query';
import { Form } from '@panneau/forms';
import { Alert, Button, Dialog, Stack } from '@panneau/ui';
import { useMemo, useState } from 'react';
import { useIntl } from 'react-intl';

import { SecretValue } from '../components/SecretValue.tsx';
import { projectFields } from '../definition.ts';

/**
 * The `new` action of projects: a dialog that creates a project, then shows its secret, once
 * (decision 0009). Panneau's create page would go back to the list without it.
 */
export function CreateProject({ onDone, onCancel }: ClientActionProps) {
    const intl = useIntl();
    const create = useCreateItem('projects');
    const fields = useMemo(() => projectFields(intl), [intl]);
    const [secret, setSecret] = useState<string | null>(null);
    const title = intl.formatMessage({ id: 'projects.actions.new' });
    return (
        <Dialog
            title={title}
            isOpen
            onOpenChange={(isOpen) => {
                if (!isOpen) {
                    if (secret === null) {
                        onCancel();
                    } else {
                        onDone();
                    }
                }
            }}
            // The secret is shown once: the dialog stays until the operator says they saved it.
            isDismissable={secret === null}
            isKeyboardDismissDisabled={secret !== null}
        >
            {secret === null ? (
                <Form
                    aria-label={title}
                    fields={fields}
                    mode="create"
                    submitLabel={intl.formatMessage({ id: 'projects.actions.create' })}
                    onSubmit={async (values) => {
                        const item = await create.mutateAsync(values);
                        setSecret(typeof item.secret === 'string' ? item.secret : '');
                        return item;
                    }}
                />
            ) : (
                <Stack gap={4}>
                    <Alert tone="warning">{intl.formatMessage({ id: 'projects.created' })}</Alert>
                    <SecretValue secret={secret} />
                    <Button variant="primary" onPress={() => onDone()}>
                        {intl.formatMessage({ id: 'common.done' })}
                    </Button>
                </Stack>
            )}
        </Dialog>
    );
}

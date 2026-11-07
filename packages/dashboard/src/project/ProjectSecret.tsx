import type { Form as FormStore } from '@panneau/core';
import { useDataAdapter } from '@panneau/data/query';
import { Alert, Button, Dialog, Select, Stack, Text } from '@panneau/ui';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';

import type { AdminProjectSecret } from '@pingpong-io/protocol';

import { SecretValue } from '../components/SecretValue.tsx';
import styles from '../components/components.module.css';
import { projectQueryKey, useLiveProject, useProjectId } from './useProject.ts';

const GRACE_PERIODS = [86400, 3600, 604800, 0] as const;

/**
 * The secret of the project, in its page: never shown, except once when it is rotated, while the
 * previous one keeps working for the grace period.
 */
export function ProjectSecret({ form }: { form: FormStore }) {
    const intl = useIntl();
    const id = useProjectId(form);
    const adapter = useDataAdapter();
    const queryClient = useQueryClient();
    const project = useLiveProject(id);
    const [gracePeriod, setGracePeriod] = useState<number>(86400);
    const [confirming, setConfirming] = useState(false);
    const [pending, setPending] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const [secret, setSecret] = useState<string | null>(null);
    if (id === null) {
        return null;
    }
    const m = (message: string, values?: Record<string, string>) =>
        intl.formatMessage({ id: message }, values);
    const rotate = async () => {
        setPending(true);
        setFailure(null);
        try {
            const { result } = await adapter.runAction('projects', 'rotate-secret', {
                selection: { ids: [id] },
                values: { gracePeriod },
            });
            setSecret((result as unknown as AdminProjectSecret).secret);
            setConfirming(false);
            await queryClient.invalidateQueries({ queryKey: projectQueryKey(id) });
        } catch (error) {
            setFailure(error instanceof Error ? error.message : String(error));
        } finally {
            setPending(false);
        }
    };
    const expires = project.data?.previousSecretExpiresAt ?? null;
    return (
        <div className={styles.block}>
            <Text weight="medium">{m('secret.title')}</Text>
            <Text as="p" size="sm" muted>
                {m('secret.hidden')}
            </Text>
            {expires !== null ? (
                <Text as="p" size="sm">
                    {m('secret.previousExpires', {
                        date: intl.formatDate(expires, { dateStyle: 'medium', timeStyle: 'short' }),
                    })}
                </Text>
            ) : null}
            <div className={styles.row}>
                <Select
                    label={m('secret.grace')}
                    options={GRACE_PERIODS.map((seconds) => ({
                        value: String(seconds),
                        label: m(`secret.grace.${seconds}`),
                    }))}
                    value={String(gracePeriod)}
                    onChange={(selected) => setGracePeriod(Number(selected))}
                />
                <Button icon={RefreshCw} onPress={() => setConfirming(true)}>
                    {m('secret.rotate')}
                </Button>
            </div>
            <Dialog
                role="alertdialog"
                size="sm"
                isOpen={confirming}
                onOpenChange={setConfirming}
                title={m('secret.rotate')}
                footer={(close) => (
                    <>
                        <Button onPress={close}>{m('common.cancel')}</Button>
                        <Button variant="primary" isPending={pending} onPress={() => void rotate()}>
                            {m('secret.rotateConfirm')}
                        </Button>
                    </>
                )}
            >
                <Text as="p">{m('secret.rotateHelp')}</Text>
                {failure !== null ? (
                    <Alert tone="danger">{m('secret.error', { message: failure })}</Alert>
                ) : null}
            </Dialog>
            <Dialog
                title={m('secret.rotate')}
                isOpen={secret !== null}
                // The secret is shown once: the dialog stays until the operator says they saved it.
                isDismissable={false}
                isKeyboardDismissDisabled
            >
                <Stack gap={4}>
                    <Alert tone="warning">{m('secret.rotated')}</Alert>
                    <SecretValue secret={secret ?? ''} />
                    <Button variant="primary" onPress={() => setSecret(null)}>
                        {m('common.done')}
                    </Button>
                </Stack>
            </Dialog>
        </div>
    );
}

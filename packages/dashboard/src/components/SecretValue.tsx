import { Button } from '@panneau/ui';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';

import styles from './components.module.css';

/** Copies a text, and says so for a moment. */
export function CopyButton({ text }: { text: string }) {
    const intl = useIntl();
    const [copied, setCopied] = useState(false);
    return (
        <Button
            size="sm"
            icon={copied ? Check : Copy}
            onPress={() => {
                void navigator.clipboard.writeText(text).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                });
            }}
        >
            {intl.formatMessage({ id: copied ? 'common.copied' : 'common.copy' })}
        </Button>
    );
}

/** A secret, shown once, with a button that copies it. */
export function SecretValue({ secret }: { secret: string }) {
    return (
        <div className={styles.secret}>
            <code className={styles.secretValue}>{secret}</code>
            <CopyButton text={secret} />
        </div>
    );
}

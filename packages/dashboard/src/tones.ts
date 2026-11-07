/** A built-in tone of Panneau's badges. */
export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** The tone of each status: of projects and of the server's checks. */
export const TONES: Record<string, Tone> = {
    active: 'success',
    disabled: 'neutral',
    ok: 'success',
    failed: 'danger',
    skipped: 'neutral',
};

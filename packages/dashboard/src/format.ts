import type { IntlShape } from 'react-intl';

/** How long ago a date was: `8 minutes ago`, `il y a 2 heures`. */
export function formatAgo(intl: IntlShape, date: string | Date, now = Date.now()): string {
    const seconds = Math.round((new Date(date).getTime() - now) / 1000);
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['day', 86_400],
        ['hour', 3600],
        ['minute', 60],
    ];
    for (const [unit, size] of units) {
        if (Math.abs(seconds) >= size) {
            return intl.formatRelativeTime(Math.round(seconds / size), unit, { numeric: 'auto' });
        }
    }
    return intl.formatRelativeTime(seconds, 'second', { numeric: 'auto' });
}

/** Bytes in the largest unit under a thousand of it: `742 MB`, `1.9 TB`. */
export function formatBytes(intl: IntlShape, bytes: number): string {
    const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;
    let value = bytes;
    let index = 0;
    while (value >= 1000 && index < units.length - 1) {
        value /= 1000;
        index += 1;
    }
    return intl.formatNumber(value, {
        style: 'unit',
        unit: units[index],
        maximumFractionDigits: value < 10 && index > 0 ? 1 : 0,
    });
}

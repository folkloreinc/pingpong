import type { IconComponent, NamedIconLoader } from '@panneau/ui';
import { ChartLine, CircleCheck, CircleOff, Plus, RadioTower, Trash2 } from 'lucide-react';

/**
 * The icons that the definition names. Panneau loads every Lucide icon by default, each in its own
 * chunk: the image would ship about 1,900 files for a few icons.
 */
const icons: Record<string, IconComponent> = {
    'chart-line': ChartLine,
    'circle-check': CircleCheck,
    'circle-off': CircleOff,
    plus: Plus,
    'radio-tower': RadioTower,
    'trash-2': Trash2,
};

export const iconLoader: NamedIconLoader = (name) => Promise.resolve(icons[name] ?? null);

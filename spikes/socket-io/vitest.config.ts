import { mergeConfig } from 'vitest/config';

import { definePackageConfig } from '../../config/vitest.package.ts';

export default mergeConfig(definePackageConfig(import.meta.dirname), {
    test: {
        testTimeout: 20_000,
    },
});

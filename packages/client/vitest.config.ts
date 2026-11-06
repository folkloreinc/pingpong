import { mergeConfig } from 'vitest/config';

import { definePackageConfig } from '../../config/vitest.package.ts';

export default mergeConfig(definePackageConfig(import.meta.dirname), {
    test: {
        // The tests start servers on the database in PINGPONG_TEST_DATABASE_URL.
        fileParallelism: false,
        testTimeout: 20_000,
    },
});

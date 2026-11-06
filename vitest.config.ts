import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        projects: ['packages/*', 'spikes/*'],
        // The server's and the client's tests share the database in PINGPONG_TEST_DATABASE_URL.
        fileParallelism: false,
    },
});

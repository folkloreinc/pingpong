import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// `npm run dev -w @pingpong-io/dashboard` serves the dashboard at /dashboard/, against the admin API
// of a local Pingpong (`PINGPONG_URL`, http://127.0.0.1:3000 by default).
const target = process.env.PINGPONG_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
    base: '/dashboard/',
    plugins: [react()],
    resolve: {
        conditions: ['@pingpong-io/source', ...defaultClientConditions],
    },
    build: {
        outDir: 'dist/app',
        emptyOutDir: true,
        // No inline script or style in the built page: the server serves it with a strict CSP.
        assetsInlineLimit: 0,
        // Panneau is one chunk: the dashboard is a single app, loaded once per session.
        chunkSizeWarningLimit: 2500,
    },
    server: {
        proxy: {
            '/admin': target,
        },
    },
});

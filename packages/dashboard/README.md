# @pingpong-io/dashboard

The operations dashboard of [Pingpong](https://github.com/folkloreinc/pingpong): a [Panneau 5](https://github.com/folkloreinc/panneau-js) app on the admin API (`/admin/v1`), in English and French ([decision 0009](https://github.com/folkloreinc/pingpong/blob/main/docs/decisions/0009-admin-api-and-dashboard.md)).

The server serves it at `/dashboard/` when `PINGPONG_ADMIN_TOKEN` is set: install `@pingpong-io/server` or run the Docker image, not this package. It ships only the built app (`dist/app`), with React and Panneau in its bundle, so the server gains no runtime dependency.

- **Overview**: the server's version and checks (`pingpong doctor`), and what it sees now: connections, channels, messages, per project.
- **Projects**: list, create (the secret is shown once), change the name, origins and limits, disable, enable, delete, rotate the secret with a grace period (the new one is shown once). A project's page shows its live connections, refusals, messages and channels.
- **Usage** (decision 0010): per project over the last 7 or 30 days or a month, messages or connection time per day, each project's share and its part of a monthly server cost (split by connection time, kept in the browser), and a CSV export. The projects list shows the messages of the last 30 days.
- **Signing in**: the operator pastes the server's admin token on Panneau's login page. It stays in the tab's `sessionStorage`, and is sent as a bearer token, never as a cookie.

Pingpong implements no Panneau protocol: the package has a static definition and a Panneau `DataAdapter` that maps it onto the admin API.

## Development

```bash
npm run build -w @pingpong-io/dashboard   # dist/app: the static app, for /dashboard/
npm run dev -w @pingpong-io/dashboard     # Vite at http://localhost:5173/dashboard/
```

The dev server sends `/admin` to a local Pingpong: `PINGPONG_URL`, `http://127.0.0.1:3000` by default, started with a `PINGPONG_ADMIN_TOKEN`.

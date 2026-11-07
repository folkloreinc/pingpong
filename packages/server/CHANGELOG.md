# @pingpong-io/server

## 0.3.0

### Minor Changes

- 7c1f9a8: Keep usage per project and UTC day in the database: messages and their bytes, connection minutes, the peak of connections, refused connections and rate-limited publish requests. Every server adds what it counted every minute (`PINGPONG_USAGE_FLUSH_INTERVAL`) and when it stops; days older than `PINGPONG_USAGE_RETENTION` (400) are deleted daily, and a deleted project's usage is kept. Read it with `pingpong usage` or `GET /admin/v1/usage`. With `PINGPONG_METRICS_PORT`, serve `/metrics` for Prometheus on a listener of its own (`PINGPONG_METRICS_HOST`, `127.0.0.1` by default), with connections, channels, messages, bytes, refusals and rate-limited requests per project. The `0002-usage` migration adds the `usage` table: run `pingpong migrate`.

### Patch Changes

- Updated dependencies [df46e0d]
- Updated dependencies [aebba1e]
  - @pingpong-io/dashboard@0.3.0
  - @pingpong-io/protocol@0.3.0

## 0.2.1

### Patch Changes

- e265fa0: A connection to a project that doesn't exist no longer leaves a Socket.IO namespace behind, and the project cache keeps at most 10,000 entries by id and as many by key, dropping expired ones first.
- @pingpong-io/dashboard@0.2.1
  - @pingpong-io/protocol@0.2.1

## 0.2.0

### Minor Changes

- 6e7cd57: Serve the admin API at `/admin/v1` when `PINGPONG_ADMIN_TOKEN` is set (at least 32 characters, sent as a bearer token): the server's status with the checks of `pingpong doctor`, and the projects, which it lists, shows, creates, changes, deletes and gives a new secret, showing a secret only once. Disabling or deleting a project through it disconnects the project's sockets. It shows each project's live channels and subscription counts, and what the server counted since it started: connections and their peak, connections refused by reason, messages published and their bytes, requests over the rate limit. Without the token, nothing changes. `pingpong doctor` now runs the same checks as the status, and says `secret key: PINGPONG_SECRET_KEY is not set` when the key is missing.
- fc9277f: Add `@pingpong-io/dashboard`, the operations dashboard: a Panneau 5 app on the admin API, in English and French. Its overview shows the server's checks and what it sees now of every project. Projects are listed, created (their secret shown once), changed, disabled, enabled and deleted, and their secret is rotated with a grace period (the new one shown once). A project's page shows its live connections, refusals, messages and channels. Operators sign in with the admin token, kept in the tab's `sessionStorage`.
  
  The server serves it at `/dashboard/` when `PINGPONG_ADMIN_TOKEN` is set, with a strict Content Security Policy; `PINGPONG_DASHBOARD=false` turns it off. The Docker image includes it.

### Patch Changes

- Updated dependencies [6e59d6c]
- Updated dependencies [fc9277f]
  - @pingpong-io/protocol@0.2.0
  - @pingpong-io/dashboard@0.2.0

## 0.1.0

### Minor Changes

- 97f77d7: First version of the server: projects in PostgreSQL or SQLite with encrypted secrets, one Socket.IO namespace per project, public and private channels, connection state recovery, subscription counts, the signed HTTP API of protocol v1, limits, the Redis Streams adapter, the `pingpong` CLI and a Docker image.

### Patch Changes

- Updated dependencies [52a1097]
  - @pingpong-io/protocol@0.1.0

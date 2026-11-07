# @pingpong-io/dashboard

## 0.3.0

### Minor Changes

- df46e0d: Add the Usage page: per project over the last 7 or 30 days or a calendar month, messages or connection time per day as stacked bars, each project's messages, bytes, connection time, peak, refusals and rate-limited requests, its share, its part of a monthly server cost (split by connection time, kept in the browser), and a CSV export. The projects list gets a "Messages, 30 days" column.

## 0.2.1

No changes in this release.

## 0.2.0

### Minor Changes

- fc9277f: Add `@pingpong-io/dashboard`, the operations dashboard: a Panneau 5 app on the admin API, in English and French. Its overview shows the server's checks and what it sees now of every project. Projects are listed, created (their secret shown once), changed, disabled, enabled and deleted, and their secret is rotated with a grace period (the new one shown once). A project's page shows its live connections, refusals, messages and channels. Operators sign in with the admin token, kept in the tab's `sessionStorage`.
  
  The server serves it at `/dashboard/` when `PINGPONG_ADMIN_TOKEN` is set, with a strict Content Security Policy; `PINGPONG_DASHBOARD=false` turns it off. The Docker image includes it.

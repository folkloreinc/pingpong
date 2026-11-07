---
'@pingpong-io/dashboard': minor
'@pingpong-io/server': minor
---

Add `@pingpong-io/dashboard`, the operations dashboard: a Panneau 5 app on the admin API, in English and French. Its overview shows the server's checks and what it sees now of every project. Projects are listed, created (their secret shown once), changed, disabled, enabled and deleted, and their secret is rotated with a grace period (the new one shown once). A project's page shows its live connections, refusals, messages and channels. Operators sign in with the admin token, kept in the tab's `sessionStorage`.

The server serves it at `/dashboard/` when `PINGPONG_ADMIN_TOKEN` is set, with a strict Content Security Policy; `PINGPONG_DASHBOARD=false` turns it off. The Docker image includes it.

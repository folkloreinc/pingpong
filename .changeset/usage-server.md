---
'@pingpong-io/server': minor
---

Keep usage per project and UTC day in the database: messages and their bytes, connection minutes, the peak of connections, refused connections and rate-limited publish requests. Every server adds what it counted every minute (`PINGPONG_USAGE_FLUSH_INTERVAL`) and when it stops; days older than `PINGPONG_USAGE_RETENTION` (400) are deleted daily, and a deleted project's usage is kept. Read it with `pingpong usage` or `GET /admin/v1/usage`. With `PINGPONG_METRICS_PORT`, serve `/metrics` for Prometheus on a listener of its own (`PINGPONG_METRICS_HOST`, `127.0.0.1` by default), with connections, channels, messages, bytes, refusals and rate-limited requests per project. The `0002-usage` migration adds the `usage` table: run `pingpong migrate`.

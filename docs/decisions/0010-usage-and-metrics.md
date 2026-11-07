# 0010: Usage per project and day, and Prometheus metrics

- Status: proposed
- Date: 2026-11-07
- Follows: [0009](0009-admin-api-and-dashboard.md), whose live stats are counted in memory, since the server started

## Context

A shared Pingpong needs to say what each project uses: to see which application publishes too much, and to split a server's cost between the projects that share it. Since 0009, each server counts per project in memory: a restart loses it, and with several servers each one only knows its own. Operators who run Prometheus also want the server's numbers in it, with their alerts. Eclair keeps usage per project and day in its database (`eclair usage`, its admin API and its dashboard) and serves `/metrics` for Prometheus.

## Decision

- **Usage per project and UTC day, in the database**, in a table `usage`: messages and their bytes, connection minutes (the sum, minute by minute, of the project's connected sockets), the peak of connections, refused connections, and publish requests over the rate limit.
    - Each server adds what it counted to the row of the day every minute, and once more when it stops, with one upsert per project: sums are added, the peak keeps the highest. PostgreSQL and SQLite both do it with `ON CONFLICT … DO UPDATE`, so several servers write the same row without locks.
    - Rows older than `PINGPONG_USAGE_RETENTION` days (400 by default) are deleted once a day. A project's usage is deleted with the project.
- **Read through `pingpong usage`, `GET /admin/v1/usage` and a Usage page of the dashboard**, over up to 400 days. The protocol describes the route first.
- **`/metrics` for Prometheus**, with `prom-client`: connections and channels (gauges), messages, bytes, refused connections and rate-limited requests (counters), each labelled with its project, and Node's default metrics. Projects are created by operators only, so the labels stay bounded; an unknown project is never a label.
    - It is off by default. `PINGPONG_METRICS_PORT` turns it on, on a listener of its own, on `127.0.0.1` unless `PINGPONG_METRICS_HOST` says otherwise: the reverse proxy in front of the API never exposes it, and it needs no token.
- The live stats of 0009 stay: they answer "what now", usage answers "what over a period".

## Consequences

- One write per active project per minute and per server: a few hundred rows a year per project.
- With several servers, the peak of connections is the highest one server saw, not the peak of their sum. Connection minutes and the other sums are exact.
- Usage written before a crash is kept; what a server counted in its last minute is lost when it is killed without stopping.
- A per-project label in Prometheus means one time series per project and metric: fine for tens of projects, to revisit for thousands.
- The dashboard follows Eclair's usage page, so operators of both read usage the same way.

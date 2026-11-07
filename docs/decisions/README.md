# Decisions

Architecture decision records for Pingpong. Each record is short: context, decision, consequences. A decision is changed by a new record that supersedes it, not by editing the old one.

| #                                                  | Decision                                                 | Status   |
| -------------------------------------------------- | -------------------------------------------------------- | -------- |
| [0001](0001-typescript-on-node.md)                 | TypeScript on Node 24                                    | Accepted |
| [0002](0002-socket-io.md)                          | Socket.IO handles the connections                        | Accepted |
| [0003](0003-projects.md)                           | Projects, with one Socket.IO namespace each              | Accepted |
| [0004](0004-channel-signatures.md)                 | The application signs private channels                   | Accepted |
| [0005](0005-repositories-packages-and-releases.md) | Repositories, packages, license and releases             | Accepted |
| [0006](0006-connection-state-recovery.md)          | Connection state recovery is an optimization             | Accepted |
| [0007](0007-signed-api-requests.md)                | Applications sign their API requests                     | Accepted |
| [0008](0008-database-and-http.md)                  | PostgreSQL or SQLite through Kysely, Fastify for the API | Accepted |
| [0009](0009-admin-api-and-dashboard.md)            | An admin API, and a dashboard served by Pingpong         | Accepted |
| [0010](0010-usage-and-metrics.md)                  | Usage per project and day, and Prometheus metrics        | Proposed |

# Pingpong

Pingpong is a self-hosted, multi-tenant realtime server. Several applications share one deployment: each one is a project, with its own keys, allowed origins, limits and usage. Applications publish messages over HTTP, and browsers and apps receive them on channels, over WebSockets or long polling.

It is built on [Socket.IO](https://socket.io), which handles the connections. Pingpong adds what a shared service needs on top of it: projects, channels authorized by the application, an HTTP API to publish, subscriber counts, and a Laravel broadcaster.

> **Status: phase 0.** Nothing is published yet. The plan is tracked in [#1](https://github.com/folkloreinc/pingpong/issues/1), and the decisions are in [`docs/decisions/`](docs/decisions/README.md).

## Why

Realtime updates (new comments, notifications, live scores, votes, progress bars) usually mean either a hosted service, billed by connection or by message, or one more WebSocket server to run next to every application. Pingpong is one service for all of them:

- **One place to run.** Applications don't run their own WebSocket server.
- **Isolated projects.** A project's channels, messages and keys never reach another project.
- **Authorization stays in the application.** For a private channel, the client asks its own application for a signature, which Pingpong verifies. Pingpong never calls the application.
- **Laravel first.** `ShouldBroadcast` events and `routes/channels.php` work as they do with any broadcaster, through `folklore/laravel-pingpong`.

## How it works

```
 Application                        Pingpong                          Browser or app
 ───────────                        ────────                          ──────────────
                                                     ◀── connects ─── project key
 /broadcasting/auth  ◀──────────────────────────────── asks for a signature
   signs the channel  ──────────────────────────────▶ subscribes ───▶ channel
 publishes over HTTP ─────────────▶ API ── room ─────────────────────▶ message
   channel, event, data
```

## Packages

| Package                     | Contents                                                     |
| --------------------------- | ------------------------------------------------------------ |
| `@pingpong-io/protocol`     | Messages, HTTP API and their schemas                         |
| `@pingpong-io/server`       | Socket.IO, the HTTP API and the `pingpong` CLI, Docker image |
| `@pingpong-io/client`       | JavaScript client                                            |
| `folklore/laravel-pingpong` | Laravel broadcaster, in its own repository                   |

## License

[MIT](LICENSE)

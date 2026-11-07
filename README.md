# Pingpong

Pingpong is a self-hosted, multi-tenant realtime server. Several applications share one deployment: each one is a project, with its own keys, allowed origins, limits and usage. Applications publish messages over HTTP, and browsers and apps receive them on channels, over WebSockets or long polling.

It is built on [Socket.IO](https://socket.io), which handles the connections. Pingpong adds what a shared service needs on top of it: projects, channels authorized by the application, an HTTP API to publish, subscriber counts, and a Laravel broadcaster.

> **Status: phase 1.** Nothing is published yet. The plan is tracked in [#1](https://github.com/folkloreinc/pingpong/issues/1). The protocol is in [`docs/protocol.md`](docs/protocol.md), running the server in [`docs/running.md`](docs/running.md), and the decisions in [`docs/decisions/`](docs/decisions/README.md).

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

| Package                     | Contents                                                           |
| --------------------------- | ------------------------------------------------------------------ |
| `@pingpong-io/protocol`     | Messages, HTTP API and their schemas                               |
| `@pingpong-io/server`       | Socket.IO, the HTTP API and the `pingpong` CLI, Docker image       |
| `@pingpong-io/client`       | JavaScript client                                                  |
| `@pingpong-io/dashboard`    | The operations dashboard, which the server serves at `/dashboard/` |
| `folklore/laravel-pingpong` | Laravel broadcaster, in its own repository                         |

## Releases

All `@pingpong-io/*` packages share one version. They are versioned with [Changesets](https://changesets.dev) and published to npm by GitHub Actions with [trusted publishing](https://docs.npmjs.com/trusted-publishers): no npm token, and each version gets a provenance attestation. The Docker image of the same version follows.

1. A pull request that changes a package comes with a changeset: `npx changeset`. CI fails without one.
2. On every push to `main`, the [Release workflow](.github/workflows/release.yml) opens or updates the "Version packages" pull request, which bumps the versions and writes the changelogs.
3. Before merging it, configure trusted publishing for the packages it publishes for the first time (below).
4. Merging it runs the workflow again: it builds and publishes the packages, pushes the `<package>@<version>` tags, creates the GitHub releases, and pushes `ghcr.io/folkloreinc/pingpong:<version>`.

Don't publish from a local machine.

### Trusted publishing

npm only accepts a publish from the Release workflow for packages that trust it. Configure a package once, with npm 11.15+, write access to the `@pingpong-io` organization and 2FA:

```bash
scripts/trust-packages.sh
```

Run on the "Version packages" branch with no argument, it configures the packages whose new version isn't on npm yet; it also takes package names. A new configuration expires if no publish succeeds with it within 2 days, so don't configure packages ahead of their release. A package that isn't configured fails to publish with `ENEEDAUTH` while the others go through: configure it and run the workflow again. The workflow file name (`release.yml`) is part of the trust: renaming it breaks publishing.

## License

[MIT](LICENSE)

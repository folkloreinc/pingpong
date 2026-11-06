# AGENTS.md

Pingpong is a self-hosted, multi-tenant realtime server built on Socket.IO: applications publish messages over HTTP, and clients receive them on channels. Packages are published as `@pingpong-io/*`. The Laravel broadcaster is `folklore/laravel-pingpong`, in its own repository.

**Language.** This is a public repository. Everything written here is in **English**: code, comments, docs, commit messages, issues and their comments, pull requests and reviews. Never copy private details from the applications that use Pingpong (product plans, infrastructure, hostnames, internal docs, client names, costs). Report security problems privately through a GitHub security advisory, never in a public issue, PR or commit message.

## Status

Pingpong is in phase 1. Read the plan and the decisions before writing code:

- **Plan:** [#1](https://github.com/folkloreinc/pingpong/issues/1). Each item becomes a sub-issue of #1 when work on it starts, and is checked when that sub-issue is closed.
- **Protocol:** [`docs/protocol.md`](docs/protocol.md) and [`packages/protocol/schema/openapi.json`](packages/protocol/schema/openapi.json), the contract between Pingpong, applications and clients.
- **Decisions:** [`docs/decisions/`](docs/decisions/README.md). Follow them. Changing one means a new decision record that supersedes it.
- **Spike:** [`spikes/socket-io/`](spikes/socket-io/README.md), what phase 0 checked in Socket.IO. Throwaway code: nothing imports it.

## Rules

1. **The protocol is the contract.** The HTTP API and the payloads of the Socket.IO events are defined in `@pingpong-io/protocol` before they are implemented. Version 1 (`/v1`) only changes additively.
2. **Socket.IO handles the connections.** Don't reimplement what it does (transports, rooms, acknowledgements, recovery, adapters). Pingpong adds projects, channels, the HTTP API and counts ([0002](docs/decisions/0002-socket-io.md)).
3. **Projects are isolated.** One Socket.IO namespace per project. Every room, message, log line and metric is scoped to a project ([0003](docs/decisions/0003-projects.md)).
4. **Authorization stays in the application.** Private and presence channels need a signature of the socket id and the channel by the project's secret. Pingpong never calls the application to authorize a channel ([0004](docs/decisions/0004-channel-signatures.md)).
5. **Recovery is an optimization.** A client that is not recovered after a reconnection subscribes again and reloads what it shows from the application ([0006](docs/decisions/0006-connection-state-recovery.md)).
6. **Secure by default.** Secrets are encrypted at rest, signatures are compared in constant time, origins are checked, and messages have a size limit.
7. **No hardcoded URLs or secrets.** They come from config and environment variables.

## Repository map

```
packages/
  protocol/   @pingpong-io/protocol: OpenAPI document, schemas of the Socket.IO events, types,
              validator, signatures
  server/     @pingpong-io/server: projects, Socket.IO, HTTP API, `pingpong` CLI
              (`@pingpong-io/server/testing` starts a server for tests)
  client/     @pingpong-io/client: JavaScript client, for browsers and Node
spikes/
  socket-io/  Phase 0 spike, private, not published
docker/       Dockerfile, entry point and smoke test
config/       Shared Vitest config
docs/         Protocol and decisions
```

## Stack

- Node 24 (`.nvmrc`), npm workspaces, ESM only.
- TypeScript 6, `strict` with `noUncheckedIndexedAccess` (`tsconfig.base.json`). Packages build with `tsc`. Relative imports use the `.ts` extension, which `tsc` rewrites to `.js`.
- Packages import each other by name. In tests and typechecks, these imports resolve to the sources through the `@pingpong-io/source` export condition, so nothing needs to be built first. A new package lists that condition in its `exports` and is added to `workspaces` after the packages it depends on.
- Tests use Vitest. Test files sit next to the code: `*.test.ts`.
- Lint with ESLint (flat config, typescript-eslint `strict`). Format with Prettier.
- Versions and changelogs with changesets. All `@pingpong-io/*` packages and the Docker image share one version.

## Commands

```bash
npm install
npm test            # Vitest, every package and spike
npm run lint        # ESLint
npm run typecheck   # tsc in every package
npm run build       # build every package
npm run format      # Prettier
npx changeset       # describe a change for the changelog

npm run generate -w @pingpong-io/protocol   # after changing the OpenAPI document
```

The server's tests run on SQLite in memory, or on the PostgreSQL database in `PINGPONG_TEST_DATABASE_URL` (emptied by the tests). Its test files run one after the other, since they share that database. Tests that need Redis are skipped without `PINGPONG_TEST_REDIS_URL`. CI runs them on PostgreSQL 16 with Redis, and on SQLite:

```bash
docker run --rm -d -p 5432:5432 -e POSTGRES_USER=pingpong -e POSTGRES_PASSWORD=pingpong postgres:16
docker run --rm -d -p 6379:6379 redis:8
PINGPONG_TEST_DATABASE_URL=postgres://pingpong:pingpong@127.0.0.1:5432/pingpong \
    PINGPONG_TEST_REDIS_URL=redis://127.0.0.1:6379 npm test
```

Running the server itself is in [`docs/running.md`](docs/running.md).

## Workflow

- `main` is the development branch until 1.0. A `v1.x` maintenance branch is created at 1.0.0.
- Branch from `main`: `feature/<issue>-<slug>`, `fix/…`, `docs/…`, `ci/…`, `refactor/…`, `chore/…`.
- **Every change comes with tests.** A bug fix adds a regression test that fails without the fix.
- **Every change to a package comes with a changeset** (`npx changeset`) that says what changed for users.
- Open a pull request to `main` with `Closes #<issue>` or `Part of #<issue>` and the checks you ran. CI checks formatting, lint, types, the build and the changeset, runs the tests on PostgreSQL with Redis and on SQLite, and builds and smoke-tests the Docker image. **Merge only when CI is green.**
- A change to the protocol is its own pull request, reviewed before the code that implements it.
- **Releases** go through the "Version packages" pull request and the Release workflow, with trusted publishing (see "Releases" in [`README.md`](README.md)). Never publish from a local machine.

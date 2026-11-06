# 0001: TypeScript on Node 24

- Status: accepted
- Date: 2026-11-06

## Context

Pingpong holds many idle connections and fans messages out to them. The language matters for its realtime libraries, I/O and maintainability more than for raw speed. The team that maintains it writes TypeScript and PHP, and already runs a TypeScript server on Node with the same tooling.

## Decision

- Pingpong is written in **TypeScript on Node 24**, ESM only, `strict` with `noUncheckedIndexedAccess`.
- It follows the Node policy of the other Folklore projects: Node 24 now, the next LTS within six months of its release.
- The tooling is the same as in the team's other Node monorepos: npm workspaces, Vitest, ESLint, Prettier and changesets.

## Consequences

- The same people can maintain the server and the JavaScript client.
- Socket.IO, the engine chosen in [0002](0002-socket-io.md), is a Node library.
- PHP code (the Laravel broadcaster) lives in its own repository ([0005](0005-repositories-packages-and-releases.md)).

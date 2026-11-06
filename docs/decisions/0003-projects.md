# 0003: Projects, with one Socket.IO namespace each

- Status: accepted
- Date: 2026-11-06

## Context

The point of Pingpong is to share one deployment between many applications. A shared secret would give no isolation, no limits and no way to know which application uses what. The spike ([`spikes/socket-io/`](../../spikes/socket-io/README.md)) checked how Socket.IO namespaces can isolate them.

## Decision

- Each application is a **project**, with:
    - a public key, which clients send when they connect, and a secret, encrypted at rest, which signs private channels ([0004](0004-channel-signatures.md)) and API requests;
    - its allowed origins, which the application can update through the API when it adds a domain;
    - limits: connections, messages per second, message size;
    - its usage: peak connections, messages and bytes.
- **Each project has its own Socket.IO namespace**, `/projects/{id}`, children of one dynamic namespace. Its middleware checks the project, the key and the `Origin` header before a socket connects. The main namespace refuses every connection.
- Every room, message, log line and metric is scoped to a project.

## Consequences

- A project's rooms, messages and recovered sessions never reach another project, even with the same channel names. The spike tests it.
- `io.of('/projects/{id}')` returns the child of the dynamic namespace, with its middleware, even before a client connected: publishing to a project with no client doesn't open a namespace without checks. The spike tests it too.
- Projects are managed by an admin, through the CLI or the admin API. There is no self-service sign-up.
- A client without an `Origin` header (a native app) is accepted on the key alone, as with any public key. Private channels still need a signature.

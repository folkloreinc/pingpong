# 0002: Socket.IO handles the connections

- Status: accepted
- Date: 2026-11-06

## Context

A realtime server needs WebSockets, a fallback for networks that block them, rooms, reconnection, a way to catch up on what a client missed, and a way to run on several servers. Writing that again is long and risky. Three ways were considered:

- **The Pusher protocol**, as Laravel Reverb and Soketi speak it. Laravel's broadcasters and the Pusher clients work as they are. But the protocol has no recovery of missed messages and no long-polling fallback in its open-source servers. Reverb is a PHP server for one application at a time; Soketi is little maintained.
- **Socket.IO.** A maintained Node library with WebSockets and long polling, rooms, acknowledgements, connection state recovery, adapters for several servers (Redis, Redis Streams), an admin UI, and official clients in JavaScript, Swift and Kotlin.
- **Our own protocol on raw WebSockets.** Full control, everything to write.

## Decision

- **Socket.IO handles the connections.** Pingpong uses its transports, rooms, acknowledgements, connection state recovery and adapters as they are.
- Pingpong adds what Socket.IO doesn't have: projects ([0003](0003-projects.md)), Laravel's public, private and presence channels with signatures ([0004](0004-channel-signatures.md)), an HTTP API to publish, subscriber counts, and later presence members, channel history, client messages and webhooks.
- Its protocol on top of Socket.IO (event names and payloads) is defined in `@pingpong-io/protocol` before it is implemented.

## Consequences

- Laravel's `reverb` and `pusher` broadcasters, pusher-js and Laravel Echo's Pusher connector don't speak to Pingpong. The Laravel broadcaster (`folklore/laravel-pingpong`), the JavaScript client and an Echo connector are part of the project.
- Pingpong needs Node: it doesn't run on edge runtimes such as Cloudflare Workers. It scales with several servers and a Redis adapter.
- Pingpong follows Socket.IO's major versions.

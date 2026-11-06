# Spike: Socket.IO for Pingpong

Phase 0 of [#1](https://github.com/folkloreinc/pingpong/issues/1). A throwaway server (`src/server.ts`) and tests that check three things before Phase 1:

1. one Socket.IO namespace per project, with the project's key and origins checked;
2. private channels signed by the application, in PHP, and checked by the server;
3. connection state recovery through a proxy that cuts the network, with WebSockets and long polling, and across two servers.

This is not the design of `@pingpong-io/server`, and nothing imports it.

```bash
npm test -w @pingpong-io/spike-socket-io
PINGPONG_TEST_REDIS_URL=redis://127.0.0.1:6379 npm test   # with the Redis Streams adapter
```

The signature test compares with PHP's `hash_hmac` when `php` is installed, and is skipped otherwise.

## Findings

| What                                       | Result                                                                                                                                                                                           | Test                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| A namespace per project                    | Works. A middleware on the dynamic namespace checks the project, the key and the origin. A project never receives another project's messages, even on a channel with the same name.              | `namespaces.test.ts`           |
| Publishing before any client connected     | `io.of('/projects/beta')` returns the child of the dynamic namespace, with its middleware: no unchecked namespace.                                                                               | `namespaces.test.ts`           |
| Signatures from PHP                        | `hash_hmac('sha256', "$socketId:$channel", $secret)` gives the same signature as Node. A signature is refused for another socket, another channel or another secret.                             | `signature.test.ts`            |
| Recovery with WebSockets                   | The client comes back with the same id, its channels (private ones included, without signing again), and the messages it missed, in order.                                                       | `recovery.test.ts`             |
| Recovery of a client that received nothing | Fails: Socket.IO needs the offset of a broadcast packet. A first packet sent to the socket's own room on connection fixes it.                                                                    | `recovery.test.ts`             |
| Recovery with long polling                 | Works once the server noticed the drop. Cutting the TCP connections alone doesn't disconnect a long-polling client, and a client back before the server noticed starts over: shorter pings help. | `recovery.test.ts`             |
| After the recovery window                  | The client starts over, without its channels: it must subscribe again and reload.                                                                                                                | `recovery.test.ts`             |
| Several servers (Redis Streams adapter)    | A client that comes back on another server is recovered, with the messages that server published meanwhile.                                                                                      | `recovery.test.ts`, with Redis |

What the spike did not check: a real reverse proxy or CDN in front (nginx, Cloudflare), sticky sessions for long polling with several servers, and the Laravel Echo connector. They come with the deployment guide and the client in Phase 1 and 2.

The decisions that follow from it are [0003](../../docs/decisions/0003-projects.md), [0004](../../docs/decisions/0004-channel-signatures.md) and [0006](../../docs/decisions/0006-connection-state-recovery.md).

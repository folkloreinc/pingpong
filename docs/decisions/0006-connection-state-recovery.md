# 0006: Connection state recovery is an optimization

- Status: accepted
- Date: 2026-11-06

## Context

Socket.IO's connection state recovery restores a socket after a short disconnection: same id, same rooms, and the packets it missed. The spike ([`spikes/socket-io/`](../../spikes/socket-io/README.md)) tried it through a proxy that cuts the network, with WebSockets and long polling, and across two servers. It works, with three limits:

1. **A client must have received a broadcast packet.** Socket.IO tracks a client's position with the offset of the last broadcast packet it received. A client that received nothing yet starts over after a drop, and misses what was published meanwhile.
2. **The server only restores a session it has closed.** If the client comes back before the server noticed the drop, it gets a new session, and the old one lingers until the ping times out (`pingInterval` + `pingTimeout`, 45 seconds by default). Through a proxy, or with long polling, the server may not notice a drop right away: the spike saw it with long polling.
3. **The window is limited** (`maxDisconnectionDuration`, two minutes by default). After it, the client starts over without its rooms.

## Decision

- **Recovery is on**, with a window of two minutes.
- **Pingpong sends a first packet to each socket when it connects**, broadcast to the socket's own room, so that every client has an offset.
- **Pings are shorter than Socket.IO's defaults**, so the server notices a drop sooner. The exact values come with the load tests: shorter pings cost more packets per idle connection.
- **A client that is not recovered starts over**: it subscribes to its channels again, with new signatures for private ones ([0004](0004-channel-signatures.md)), and tells the application to reload what it shows. `@pingpong-io/client` does it, and exposes `recovered`.
- **With several servers, Pingpong uses the Redis Streams adapter**, which keeps recovery working when the client comes back on another server. The spike tests it. Long polling then needs sticky sessions at the load balancer.

## Consequences

- Recovery covers short drops: a phone changing networks, a proxy restart, a deploy. Longer ones fall back to reloading from the application, which every client must handle anyway.
- A channel history beyond the recovery window (the last messages of a channel when a client joins) is a separate feature, for later.

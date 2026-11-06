# 0004: The application signs private channels

- Status: accepted
- Date: 2026-11-06

## Context

Who may join a private channel is the application's business: in Laravel, `routes/channels.php`. A shared server can learn the answer in two ways: call the application for every subscription, with the user's cookies or token, or check a signature that the application gave the client. Calling the application needs the user's credentials on another domain, ties every subscription to the application's availability, and makes the server call many applications.

## Decision

- **The client asks its own application for a signature** (in Laravel, the `/broadcasting/auth` route), with its session or token, then sends it to Pingpong with the subscription. **Pingpong never calls the application to authorize a channel.**
- The signature is an HMAC-SHA256, in lowercase hex, of `{socketId}:{channel}` with the project's secret, and `{socketId}:{channel}:{channelData}` for a presence channel, where `channelData` is the JSON of the member. In PHP: `hash_hmac('sha256', "$socketId:$channel", $secret)`.
- Channels follow Laravel's prefixes: `private-…` and `presence-…` need a signature; any other channel is public.
- Pingpong compares signatures in constant time, and refuses a malformed one without throwing.

## Consequences

- A signature is only good for one socket and one channel. A recovered socket keeps its id, its channels and their signatures ([0006](0006-connection-state-recovery.md)); a new socket asks for new signatures.
- The Laravel broadcaster's `/broadcasting/auth` answer and validation follow Socket.IO's socket ids, not the Pusher format (`123.456`).
- The spike checks that PHP's `hash_hmac` gives the same signature as the server.

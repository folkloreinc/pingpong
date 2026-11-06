# 0007: Applications sign their API requests

- Status: accepted
- Date: 2026-11-06

## Context

Applications publish through the HTTP API. They could authenticate with a bearer token, as with most APIs, or sign each request with their secret. Pingpong already keeps each project's secret in a form it can read, encrypted at rest, because it checks channel signatures with it ([0004](0004-channel-signatures.md)). A bearer token would be one more credential per project, sent in clear with every request; any log or proxy that keeps headers would keep it.

## Decision

- Every `/v1` request carries the project's public key (`Pingpong-Key`) and a signature (`Pingpong-Signature: t=<unix time>,v1=<hex HMAC-SHA256>`), the HMAC-SHA256 of `{t}.{method}.{path}.{sha256 of the body}` with the project's secret. The format is that of Eclair's webhooks, so the same code can check both.
- Pingpong refuses timestamps more than five minutes from its clock, and compares signatures in constant time.
- **One secret per project** signs both API requests and private channels. After a rotation, the previous secret stays valid for a grace period (24 hours by default), for both; requests can carry one `v1` value per secret.
- The admin side (projects, keys, limits) goes through the `pingpong` CLI, on the server, not the HTTP API, for now.

## Consequences

- The secret never travels. A captured request can be replayed within five minutes; publishing the same message twice is harmless, and replacing the origins with the same list too.
- Applications need a few lines of code to sign, in any language: the protocol documents them in PHP, and `@pingpong-io/protocol/signatures` has them in Node. `folklore/laravel-pingpong` does it for Laravel.
- Clients and servers need clocks within five minutes of each other.

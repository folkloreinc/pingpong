# Protocol

Pingpong has two sides. **Applications** publish messages through the HTTP API, signed with their project's secret. **Clients** (browsers, apps) connect over Socket.IO to their project's namespace and subscribe to channels. The contract is [`packages/protocol/schema/openapi.json`](../packages/protocol/schema/openapi.json): the HTTP API, and the payloads of the Socket.IO events as `Socket*` schemas. This page explains how they fit together.

Version 1 (`/v1`) only changes additively. Request bodies refuse unknown fields; responses and event payloads can gain fields, which clients ignore.

## Projects, keys and secrets

Each application is a project ([0003](decisions/0003-projects.md)), with:

- an **id**, which is also its namespace: `/projects/{project}`;
- a **public key** (`pk_…`), which clients send when they connect and applications send with every API request. It isn't a secret;
- a **secret** (`sk_…`), which never leaves the application's server. It signs API requests and private channels. After a rotation, the previous secret stays valid for a grace period, so applications can deploy the new one without downtime;
- its **allowed origins**, its **limits** (connections, messages per second, message size, channels per socket).

## Channels

A channel is a name (`comments.article-1`, `private-users.42`): letters, digits and `_-=@,.;:`, up to 200 characters. Channels don't need to be created.

- Any channel is **public** unless its name starts with `private-` or `presence-`: any client of the project can subscribe to it.
- A **private** channel (`private-…`) needs a signature from the application ([0004](decisions/0004-channel-signatures.md)).
- **Presence** channels (`presence-…`) are refused for now (`unsupported_channel`): who is on a channel comes later. The number of subscribers of any channel is already available.

## Publishing

An application publishes with `POST /v1/messages`:

```json
{
    "channels": ["comments.article-1"],
    "event": "comment.created",
    "data": { "id": 42, "author": "Alex", "body": "Hello" }
}
```

Every socket subscribed to one of the channels receives a `message` event. `exceptSocketId` leaves out the socket whose action caused the message (Laravel's `toOthers()`). `POST /v1/messages/batch` publishes up to 100 messages, in order, in one request.

A message, once serialized, must fit in the project's limit: 10 KB by default. What it contains is up to the application: only ids and a topic, with clients reloading from the application, or the data itself. Personal data goes on private channels.

`GET /v1/channels/{channel}` returns how many sockets are subscribed to a channel right now:

```json
{ "channel": "comments.article-1", "occupied": true, "subscriptionCount": 128 }
```

`PUT /v1/origins` replaces the origins clients may connect from, for example when the application adds a domain:

```json
{ "origins": ["https://example.com", "https://*.example.com"] }
```

## Signing API requests

Every API request carries two headers:

- `Pingpong-Key`: the project's public key;
- `Pingpong-Signature`: `t=<unix time>,v1=<hex HMAC-SHA256>`.

The HMAC is of `{t}.{method}.{path}.{sha256}` with the project's secret:

- `method` is upper case (`POST`);
- `path` is the request target as sent, path and query string, without the host (`/v1/channels/comments.article-1`);
- `sha256` is the hex SHA-256 of the raw body, or of an empty body for a `GET`.

Pingpong refuses a timestamp more than five minutes from its clock, and compares signatures in constant time. During the grace period of a rotation, a request can carry one `v1` value per secret. The secret itself is never sent. In PHP:

```php
$body = json_encode($message);
$t = time();
$signature = hash_hmac('sha256', "$t.POST./v1/messages.".hash('sha256', $body), $secret);
// Pingpong-Signature: t=$t,v1=$signature
```

`signRequest()` and `verifyRequestSignature()` in `@pingpong-io/protocol/signatures` do the same in Node.

## Connecting

A client connects with Socket.IO to its project's namespace, with the project's public key in the handshake's `auth`:

```js
const socket = io('https://pingpong.example.com/projects/my-app', {
    auth: { key: 'pk_live_xxxxxxxxxxxxxxxx' },
});
```

Pingpong checks the project, the key and, when the client sends one, the `Origin` header. When it refuses, the client receives a `connect_error` whose `message` is one of `SocketConnectError`:

| Error                  | Meaning                                      | The client    |
| ---------------------- | -------------------------------------------- | ------------- |
| `unknown_project`      | No project with this id                      | stops         |
| `invalid_key`          | The key isn't the project's                  | stops         |
| `origin_not_allowed`   | The `Origin` isn't one of the project's      | stops         |
| `project_disabled`     | The project is disabled                      | stops         |
| `too_many_connections` | The project reached its limit of connections | retries later |

After each connection, the first event a socket receives is `pingpong:connected`:

```json
{ "socketId": "Xk2cHvB1mLqQ9a8cAAAB", "recovered": false }
```

## Subscribing

The client sends `subscribe` with an acknowledgement:

```json
{
    "channel": "private-users.42",
    "signature": "3f0c5c9f4d8e5d1f0e7a0d8c2b6a4e1f9c7b5a3d1e9f7c5b3a1d9e7f5c3b1a90"
}
```

For a private channel, the client first asks its application for the signature of its socket id and the channel. With Laravel, that is the `/broadcasting/auth` route of `folklore/laravel-pingpong`, which checks `routes/channels.php`. Pingpong never calls the application.

The acknowledgement is `{ "ok": true, "subscriptionCount": 3 }`, or `{ "ok": false, "error": "invalid_signature" }` (see `SocketSubscribeError`). `unsubscribe` takes `{ "channel": "…" }` and acknowledges `{ "ok": true }`.

## Receiving

A published message arrives as a `message` event, once per channel the socket is subscribed to:

```json
{ "channel": "comments.article-1", "event": "comment.created", "data": { "id": 42 } }
```

When the number of subscribers of a channel changes, its subscribers receive `pingpong:subscription_count`, at most once every few seconds per channel:

```json
{ "channel": "comments.article-1", "subscriptionCount": 129 }
```

## Disconnections

Socket.IO reconnects by itself. After a short disconnection (two minutes by default), Pingpong recovers the socket ([0006](decisions/0006-connection-state-recovery.md)): same id, same channels, and the messages it missed, in order. `pingpong:connected` then says `"recovered": true`.

When it says `"recovered": false`, the socket is new: the client subscribes to its channels again, with new signatures for private ones, and reloads what it shows from the application, since it may have missed messages. `@pingpong-io/client` does it.

## The admin API

`/admin/v1` is for the server's operators and its dashboard ([0009](decisions/0009-admin-api-and-dashboard.md)), not for applications. It exists only when the server has an admin token (`PINGPONG_ADMIN_TOKEN`), which requests send as a bearer token: `Authorization: Bearer <token>`. It does what the `pingpong projects` CLI does, and shows the server's live state.

| Request                                               | What it does                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `GET /admin/v1/status`                                | The server's version, the checks of `pingpong doctor`, connections, channels                      |
| `GET /admin/v1/projects`                              | The projects                                                                                      |
| `POST /admin/v1/projects`                             | Create a project. The response has its secret, this once                                          |
| `GET /admin/v1/projects/{project}`                    | A project, without its secret                                                                     |
| `PATCH /admin/v1/projects/{project}`                  | Change its name, origins, limits, or disable it                                                   |
| `DELETE /admin/v1/projects/{project}`                 | Delete it                                                                                         |
| `POST /admin/v1/projects/{project}/rotate-secret`     | A new secret, this once. The previous one works for the grace period                              |
| `GET /admin/v1/projects/{project}/channels`           | Its channels and their subscribers, most subscribed first                                         |
| `GET /admin/v1/projects/{project}/channels/{channel}` | One channel                                                                                       |
| `GET /admin/v1/usage?days=30&project=my-app`          | Usage per project and UTC day, kept in the database ([0010](decisions/0010-usage-and-metrics.md)) |

Creating a project:

```json
{
    "id": "my-app",
    "name": "My app",
    "origins": ["https://example.com", "https://*.example.com"],
    "limits": { "maxConnections": 500 }
}
```

Changing one: what the request has changes, the rest stays. `origins` replaces the list, and a limit set to `null` goes back to the server's default. Disabling a project, or deleting it, disconnects its sockets on every server.

```json
{ "origins": ["https://example.com"], "limits": { "maxConnections": null }, "disabled": true }
```

A project comes with `stats`: what the server that answers counted since it started. They are kept in memory, per server, like subscription counts:

```json
{
    "since": "2026-11-06T20:00:00Z",
    "connections": 412,
    "peakConnections": 530,
    "connectionsRefused": { "origin_not_allowed": 3 },
    "channels": 87,
    "messages": 15230,
    "bytes": 2048311,
    "rateLimited": 0
}
```

Usage is kept per project and UTC day ([0010](decisions/0010-usage-and-metrics.md)): every server adds its counts to the day's row every minute, so today is up to a minute behind. A line of `GET /admin/v1/usage`:

```json
{
    "project": "my-app",
    "day": "2026-11-06",
    "messages": 15230,
    "bytes": 2048311,
    "connectionMinutes": 381220,
    "peakConnections": 530,
    "connectionsRefused": 3,
    "rateLimited": 0
}
```

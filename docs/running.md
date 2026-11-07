# Running Pingpong

Pingpong is one Node process: the HTTP API and Socket.IO on the same port. It needs a database, PostgreSQL or SQLite (decision 0008), and optionally Redis, to run several servers.

## With Docker

```bash
docker run --rm -v pingpong:/var/lib/pingpong \
    -e PINGPONG_DATABASE_URL=sqlite:///var/lib/pingpong/pingpong.db \
    -e PINGPONG_SECRET_KEY="$(openssl rand -hex 32)" \
    ghcr.io/folkloreinc/pingpong migrate
```

Then the same with `serve` (the default command), with `-p 3000:3000`. `projects …` and `doctor` run the CLI in the image. Keep `PINGPONG_SECRET_KEY` somewhere safe: it encrypts the projects' secrets, and a new one can't read them.

## Configuration

| Variable                                          | Default           | What it is                                                                                        |
| ------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `PINGPONG_DATABASE_URL`                           | required          | `postgres://user:password@host:5432/pingpong`, or `sqlite:///var/lib/pingpong/pingpong.db`        |
| `PINGPONG_SECRET_KEY`                             | required          | 32 bytes, as 64 hex characters or base64 (`openssl rand -hex 32`). Encrypts the projects' secrets |
| `PINGPONG_DASHBOARD`                              | `true`            | With the admin token, serves the dashboard at `/dashboard/`. `false` turns it off                 |
| `PINGPONG_ADMIN_TOKEN`                            | none              | At least 32 characters (`openssl rand -hex 32`). Turns on the admin API, `/admin/v1`              |
| `PINGPONG_REDIS_URL`                              | none              | With Redis, Socket.IO uses the Redis Streams adapter: several servers share messages and recovery |
| `PINGPONG_HOST`, `PINGPONG_PORT`                  | `0.0.0.0`, `3000` |                                                                                                   |
| `PINGPONG_PING_INTERVAL`, `PINGPONG_PING_TIMEOUT` | `10000`, `5000`   | Milliseconds. Shorter than Socket.IO's defaults, so drops are noticed sooner (decision 0006)      |
| `PINGPONG_RECOVERY_WINDOW`                        | `120000`          | How long a disconnected socket can be recovered, in milliseconds                                  |
| `PINGPONG_COUNT_INTERVAL`                         | `2000`            | Subscription counts are sent at most this often per channel, in milliseconds                      |
| `PINGPONG_SECRET_GRACE_PERIOD`                    | `86400`           | Seconds the previous secret stays valid after a rotation                                          |
| `PINGPONG_PROJECT_CACHE_TTL`                      | `5000`            | Milliseconds before a project changed by the CLI or another server is read again                  |
| `PINGPONG_MAX_CONNECTIONS`                        | `10000`           | Default limits of projects that don't set their own                                               |
| `PINGPONG_MAX_MESSAGES_PER_SECOND`                | `100`             | Messages a project may publish per second, one per channel                                        |
| `PINGPONG_MAX_MESSAGE_SIZE`                       | `10240`           | Bytes of a message, serialized                                                                    |
| `PINGPONG_MAX_CHANNELS_PER_SOCKET`                | `100`             |                                                                                                   |
| `PINGPONG_TRUST_PROXY`                            | `false`           | Trust `X-Forwarded-*` from a reverse proxy                                                        |
| `PINGPONG_LOG_LEVEL`                              | `info`            | `fatal`, `error`, `warn`, `info`, `debug`, `trace`                                                |
| `PINGPONG_USAGE_FLUSH_INTERVAL`                   | `60000`           | Milliseconds between two writes of usage to the database                                          |
| `PINGPONG_USAGE_RETENTION`                        | `400`             | UTC days of usage kept, today included                                                            |
| `PINGPONG_METRICS_PORT`                           | none              | Serves `/metrics` for Prometheus on this port, apart from the API                                 |
| `PINGPONG_METRICS_HOST`                           | `127.0.0.1`       | The address of `/metrics`                                                                         |

## Projects

```bash
pingpong projects create my-app --name "My app" --origin https://example.com --origin "https://*.example.com"
pingpong projects list
pingpong projects show my-app
pingpong projects update my-app --max-connections 500 --origin https://example.com
pingpong projects rotate-secret my-app
pingpong projects delete my-app --yes
```

The [admin API](#the-admin-api) does the same over HTTP. `create` and `rotate-secret` show the secret once: put it in the application's environment. After a rotation, the previous secret works for the grace period, so the application can deploy the new one without downtime. A limit set to `default` goes back to the server's default. A project without origins accepts any client that has its key; private channels still need a signature.

## The admin API

With `PINGPONG_ADMIN_TOKEN`, the server answers the admin API at `/admin/v1` (decision 0009): what the `pingpong projects` commands do, the checks of `pingpong doctor`, and what the server sees live, such as its connections and the channels of each project. Requests send the token as a bearer token. [`docs/protocol.md`](protocol.md#the-admin-api) lists its routes, and the OpenAPI document describes them.

```bash
curl -H "Authorization: Bearer $PINGPONG_ADMIN_TOKEN" https://pingpong.example.com/admin/v1/status
curl -H "Authorization: Bearer $PINGPONG_ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d '{"id": "my-app", "origins": ["https://example.com"]}' https://pingpong.example.com/admin/v1/projects
```

The token can do what a shell on the server can do: keep it with the secret key, and send it only over HTTPS. Changing it means restarting the server. Disabling or deleting a project through the admin API disconnects its sockets right away; through the CLI, which runs in its own process, connected sockets stay until they reconnect.

The live numbers are those of the server that answers, since it started: connections now and at their peak, connections refused by reason, messages published and their bytes, requests over the rate limit. A restart starts them again.

## The dashboard

With the admin token, the server also serves the operations dashboard at `/dashboard/`: the server's checks and live numbers, and the projects, which it creates, changes, disables, deletes and gives a new secret, showing a secret only once. Operators sign in by pasting the admin token, which stays in the browser tab's `sessionStorage` until they close it or log out, and is sent as a bearer token, never as a cookie. It speaks English and French, after the browser's language. `PINGPONG_DASHBOARD=false` turns it off.

The dashboard is served from the same origin as the admin API, with a strict Content Security Policy: its own scripts, styles and images only, and requests to its own origin.

## Usage

Pingpong keeps what each project used per UTC day in its database (decision 0010): messages and their bytes, connection minutes (its connected sockets added up minute by minute, to split a server's cost), the peak of connections, refused connections and publish requests over the rate limit. Every server adds what it counted to the day's rows every `PINGPONG_USAGE_FLUSH_INTERVAL`, and once more when it stops: several servers add to the same rows, and today is up to a minute behind. With several servers, the peak is the highest one server saw, not the peak of their sum.

```bash
pingpong usage                       # the last 30 days, per project, with each one's share
pingpong usage --days 7 --project my-app --json
```

The admin API answers the same at `GET /admin/v1/usage`, and the dashboard has a Usage page. Rows older than `PINGPONG_USAGE_RETENTION` days are deleted once a day. A project's usage is kept when the project is deleted, under its id: a project created again with the same id adds to it.

## Metrics

With `PINGPONG_METRICS_PORT`, each server serves `/metrics` for Prometheus on a listener of its own, on `127.0.0.1` unless `PINGPONG_METRICS_HOST` says otherwise: a reverse proxy in front of the API never exposes it, and it needs no token. Each metric is labelled with its project; only projects in the database are labels.

| Metric                                                                      | What it is                                                                                                       |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pingpong_connections{project}`                                             | Sockets connected now, on this server                                                                            |
| `pingpong_channels{project}`                                                | Channels with at least one subscriber now, on this server                                                        |
| `pingpong_messages_total{project}`, `pingpong_message_bytes_total{project}` | Messages published (one per channel) and their bytes                                                             |
| `pingpong_connections_refused_total{project,reason}`                        | Connections refused, by reason (`invalid_key`, `origin_not_allowed`, `project_disabled`, `too_many_connections`) |
| `pingpong_rate_limited_total{project}`                                      | Publish requests over the project's limit of messages per second                                                 |
| `pingpong_process_*`, `pingpong_nodejs_*`                                   | Node's own metrics                                                                                               |

Alerts to start with: `pingpong_connections` near a project's limit; `pingpong_rate_limited_total` that increases (an application publishes faster than its limit); `pingpong_connections_refused_total{reason="origin_not_allowed"}` that increases after a deployment (a domain missing from the origins); `/health` that answers `503`.

## Keeping the admin API to the operators

On a server that the internet reaches, a rule of the reverse proxy can keep `/admin/` and `/dashboard/` to the operators, for example by address:

```nginx
location ~ ^/(admin|dashboard)/ {
    allow 203.0.113.0/24;
    deny all;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}
```

## Behind a reverse proxy

Socket.IO uses WebSockets, with long polling as a fallback. A proxy relays both:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 120s;
}
```

A site can also serve Pingpong under a path of its own domain, with its own proxy (`location /pingpong/ { proxy_pass http://pingpong:3000/; … }`): the client then connects with `path: '/pingpong/socket.io'`.

## Several servers

With `PINGPONG_REDIS_URL`, every server shares messages and recovered sessions through Redis Streams. Long polling then needs sticky sessions at the load balancer. For now, rate limits, connection limits and subscription counts are counted per server.

## Checks

`pingpong doctor` checks the database, the migrations, that the secret key decrypts every project's secret, and Redis. `GET /admin/v1/status` gives the same checks. `GET /health` answers 200 while the database and Redis answer, for load balancers.

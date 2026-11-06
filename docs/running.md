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

## Projects

```bash
pingpong projects create my-app --name "My app" --origin https://example.com --origin "https://*.example.com"
pingpong projects list
pingpong projects show my-app
pingpong projects update my-app --max-connections 500 --origin https://example.com
pingpong projects rotate-secret my-app
pingpong projects delete my-app --yes
```

`create` and `rotate-secret` show the secret once: put it in the application's environment. After a rotation, the previous secret works for the grace period, so the application can deploy the new one without downtime. A limit set to `default` goes back to the server's default. A project without origins accepts any client that has its key; private channels still need a signature.

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

`pingpong doctor` checks the database, the migrations, that the secret key decrypts every project's secret, and Redis. `GET /health` answers 200 while the database and Redis answer, for load balancers.

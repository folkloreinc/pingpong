# 0009: An admin API, and a dashboard served by Pingpong

- Status: accepted
- Date: 2026-11-06
- Supersedes: the last point of [0007](0007-signed-api-requests.md) (the admin side goes through the CLI only)

## Context

Projects are managed with the `pingpong` CLI, on the server ([0007](0007-signed-api-requests.md)). Creating a project, adding an origin or rotating a secret means a shell on the server, and nothing shows how many clients are connected, or to which channels. Eclair, the other shared Node service, has an admin API and an operations dashboard, a Panneau 5 app that its API serves ([its decision 0021](https://github.com/urbania-media/eclair/blob/main/docs/decisions/0021-dashboard-on-panneau.md)).

## Decision

- **An admin API, `/admin/v1`**, defined in `@pingpong-io/protocol` like `/v1`:
    - It exists only when `PINGPONG_ADMIN_TOKEN` is set. Without it, its routes answer 404.
    - The token is sent as a bearer token and compared in constant time. It has at least 32 characters: a shorter one is a configuration error. It is one token for the server, not per project, so it isn't a signature: there is no project secret to sign with.
    - Every response is `Cache-Control: no-store`.
- **It does what the CLI does:** list, show, create, change (name, origins, limits, enabled) and delete projects, and rotate a secret with a grace period. A secret is in the response that creates it, once, as with the CLI. No other response has one.
- **Disabling or deleting a project through the API disconnects its sockets**, through the adapter, so on every server. The CLI runs in its own process and can't: its changes reach connected clients when they reconnect.
- **It shows what the server knows, live:** its status (version, uptime, and the checks of `pingpong doctor`, which the CLI and the API share), and per project its connections, its channels with their subscription counts, and counters since the server started (peak connections, refused connections by reason, messages published and their bytes, requests over the rate limit). They are kept in memory and counted per server, like subscription counts. Usage kept per day, `pingpong usage` and `/metrics` are a later decision.
- **A dashboard, `@pingpong-io/dashboard`**, a Panneau 5 app built with Vite:
    - A static definition and a `DataAdapter` that maps it onto `/admin/v1`. The server knows nothing about Panneau.
    - The package ships only the built app, React and Panneau bundled in it: the server depends on it for its files, and gains no runtime dependency.
    - Signing in is the admin token: the operator pastes it, it is kept in `sessionStorage` for the tab, and sent as a bearer token, never as a cookie.
    - English and French.
- **Served by Pingpong at `/dashboard/`**, when `PINGPONG_ADMIN_TOKEN` is set; `PINGPONG_DASHBOARD=false` turns it off. Same origin as the admin API, so there is no CORS, and a strict Content Security Policy: its own scripts, styles, images and requests only. The image includes it.
- What Eclair's dashboard already does (serving the files, the policy, keeping the token) is copied, as [0008](0008-database-and-http.md) did with the SQLite adapter.

## Consequences

- Whoever holds the admin token can do what the CLI does, from anywhere that reaches the server: the same trust as a shell on it, through HTTPS. A public server should keep `/admin/` and `/dashboard/` behind a rule of its reverse proxy (an IP allow list, a single sign-on proxy); `docs/running.md` shows one.
- Changing the token means restarting the server. Accounts per operator would be a decision of their own.
- Without `PINGPONG_ADMIN_TOKEN`, nothing changes for an install.
- The dashboard follows Panneau's 5.0 alphas: their changes are absorbed in its package, and each release of Pingpong pins the version it built.
- With several servers, the live numbers are those of the server that answers, until counts are kept in Redis.

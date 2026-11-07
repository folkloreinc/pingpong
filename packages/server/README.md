# @pingpong-io/server

The [Pingpong](https://github.com/folkloreinc/pingpong) server: projects, Socket.IO namespaces and channels, the HTTP API, the admin API (with `PINGPONG_ADMIN_TOKEN`) and the `pingpong` CLI. It implements [`@pingpong-io/protocol`](../protocol). Running it is described in [`docs/running.md`](https://github.com/folkloreinc/pingpong/blob/main/docs/running.md); the image is `ghcr.io/folkloreinc/pingpong`.

```ts
import { createPingpongServer, loadConfig } from '@pingpong-io/server';

const server = await createPingpongServer(loadConfig(process.env));
await server.listen();
```

`@pingpong-io/server/testing` starts a server on a free port with an empty database, for the tests of clients and integrations.

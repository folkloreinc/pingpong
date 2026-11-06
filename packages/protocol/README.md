# @pingpong-io/protocol

The protocol between [Pingpong](https://github.com/folkloreinc/pingpong), the applications that publish and the clients that subscribe. [`docs/protocol.md`](https://github.com/folkloreinc/pingpong/blob/main/docs/protocol.md) explains it.

- [`schema/openapi.json`](schema/openapi.json): the OpenAPI 3.1 document, written by hand. It is the reference for the HTTP API, and its `Socket*` schemas are the payloads of the Socket.IO events.
- [`schema/pingpong.schema.json`](schema/pingpong.schema.json): the same schemas as one JSON Schema (2020-12). Reference a definition with `urn:pingpong:protocol:v1#/$defs/PublishRequest`.
- TypeScript types and a validator, generated from the OpenAPI document.
- `@pingpong-io/protocol/events`: the Socket.IO event names, without Node dependencies.
- `@pingpong-io/protocol/signatures`: signing and checking API requests and private channels, in Node.

```ts
import { toProblemErrors, validate } from '@pingpong-io/protocol';
import { signRequest } from '@pingpong-io/protocol/signatures';

const body = JSON.stringify({ channels: ['comments.article-1'], event: 'comment.created' });
const result = validate('PublishRequest', JSON.parse(body));
if (!result.valid) {
    console.log(toProblemErrors(result.errors)); // { "/channels/0": ["must match pattern …"] }
}

const signature = signRequest(secret, { method: 'POST', path: '/v1/messages', body });
```

## Changing the protocol

Version 1 only changes additively. Edit `schema/openapi.json`, run `npm run generate -w @pingpong-io/protocol` to update the generated files, and open a pull request of its own, reviewed before the code that implements it.

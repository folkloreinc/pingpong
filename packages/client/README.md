# @pingpong-io/client

The JavaScript client of [Pingpong](https://github.com/folkloreinc/pingpong), for browsers and Node, on socket.io-client. It implements the client side of [the protocol](https://github.com/folkloreinc/pingpong/blob/main/docs/protocol.md).

```ts
import { Pingpong, laravelAuthorizer } from '@pingpong-io/client';

const pingpong = new Pingpong({
    url: 'https://pingpong.example.com',
    project: 'my-app',
    key: 'pk_…', // the project's public key
    authorize: laravelAuthorizer(), // signs private channels through /broadcasting/auth
});

const comments = pingpong.subscribe('comments.article-1', (message) => {
    console.log(message.event, message.data);
});
comments.on('subscriptionCount', (count) => console.log(`${count} readers`));

pingpong.subscribe('private-users.42').on('message', showNotification);

// The socket couldn't be recovered after a disconnection: the client subscribed again, but
// messages may have been missed. Reload what the page shows.
pingpong.on('reset', () => reloadComments());
```

- **Subscriptions** start as soon as the client is connected, and come back after every reconnection. Several subscriptions to one channel share one subscription on the server. `subscription.unsubscribe()` leaves the channel when it was the last one.
- **Private channels** (`private-…`) need `authorize`: a function that receives `{ socketId, channel }` and returns the application's signature. `laravelAuthorizer()` posts them to the route of `folklore/laravel-pingpong` (`/broadcasting/auth` by default), with the session cookie and Laravel's `XSRF-TOKEN`.
- **Recovery**: after a short disconnection the server gives back the channels and the missed messages, and `connected` says `recovered: true`. Otherwise the client subscribes again, with new signatures, and emits `reset`.
- **Errors**: `error` on the client when the server refuses the connection (`invalid_key`, `origin_not_allowed`…: the client stops; `too_many_connections`: it connects again later). `error` on a subscription when the server refuses it (`invalid_signature`, `unsupported_channel`, `too_many_channels`) or the application refuses to sign it (`authorization_failed`).
- `socketOptions` go to socket.io-client: `path: '/pingpong/socket.io'` when Pingpong is served under a path of the site.

# Load tests

`load.js` is a [k6](https://k6.io) script for the load tests of decision 0023: 10,000 concurrent connections and 200 messages per second. Subscribers hold Socket.IO connections over raw WebSockets, spread over `CHANNELS` public channels (`load.0`, `load.1`, …). Once they are all connected, a publisher posts signed messages to random channels through the HTTP API. Each message carries the time it was sent, and subscribers measure how long it took to arrive.

Create a project for the test, with limits above the test's:

```bash
pingpong projects create loadtest --max-connections 20000 --max-messages-per-second 1000
```

Then run it with the project's key and secret (`ulimit -n 65536` first, on the machine that runs k6):

```bash
k6 run -e URL=https://pingpong.example.com -e PROJECT=loadtest -e KEY=pk_… -e SECRET=sk_… load-tests/load.js
```

| Variable      | Default |                                                  |
| ------------- | ------- | ------------------------------------------------ |
| `CONNECTIONS` | `10000` | Concurrent connections                           |
| `CHANNELS`    | `100`   | Channels the connections are spread over         |
| `RATE`        | `200`   | Messages published per second                    |
| `RAMP`        | `2m`    | Time to open the connections                     |
| `HOLD`        | `5m`    | Time they stay open while messages are published |
| `ORIGIN`      | none    | `Origin` header, for a project that checks it    |

The test fails when fewer than 99% of the connections, subscriptions or publications succeed, or when the delivery delay is over 500 ms at the 95th percentile or 1 s at the 99th. `pingpong_unexpected_closes` counts connections the server dropped.

Clients connect from one address: behind Cloudflare, its protection may slow or block them. Delete the project afterwards.

## Results

- 2026-11-10, local (MacBook, server and k6 on the same machine, SQLite): 10,000 connections, 200 messages per second for 60 s to 100 channels, 1.2 million deliveries. All connections and publications succeeded, no connection dropped; delivery p95 3 ms, max 145 ms.
- 2026-11-10, rehearsal on `pingpong.urbania.ca` from Montréal, through Cloudflare, without a transcoding: 1,000 connections from one address, 20 messages per second for 2 minutes to 100 channels. All connections and publications succeeded, no connection dropped, 23,997 deliveries of 24,000 (the last ones cut off by the end of the test); delivery p95 71 ms, max 718 ms; WebSocket connection p95 168 ms. Cloudflare didn't slow the connections.

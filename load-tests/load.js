// Load test of a Pingpong server (decision 0023): subscribers hold Socket.IO connections over raw
// WebSockets (k6 has no Socket.IO client), and a publisher posts signed messages through the HTTP API.
// Every message carries the time it was sent: subscribers measure the delay until they receive it.
//
//   k6 run -e URL=http://127.0.0.1:3000 -e PROJECT=loadtest -e KEY=pk_… -e SECRET=sk_… load-tests/load.js
//
// CONNECTIONS (10000), CHANNELS (100), RATE (200 messages per second), RAMP (2m) and HOLD (5m) tune it.
// ORIGIN sends an Origin header, for a project that checks its origins.
import { check } from 'k6';
import crypto from 'k6/crypto';
/* global __ENV, __VU */
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import ws from 'k6/ws';

const URL = __ENV.URL || 'http://127.0.0.1:3000';
const PROJECT = __ENV.PROJECT || 'loadtest';
const KEY = __ENV.KEY;
const SECRET = __ENV.SECRET;
const ORIGIN = __ENV.ORIGIN;
const CONNECTIONS = Number(__ENV.CONNECTIONS || 10000);
const CHANNELS = Number(__ENV.CHANNELS || 100);
const RATE = Number(__ENV.RATE || 200);
const RAMP = __ENV.RAMP || '2m';
const HOLD = __ENV.HOLD || '5m';

const NAMESPACE = `/projects/${PROJECT}`;
const WS_URL = `${URL.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;

const delivery = new Trend('pingpong_delivery_ms', true);
const received = new Counter('pingpong_messages_received');
const connected = new Rate('pingpong_connected');
const subscribed = new Rate('pingpong_subscribed');
const connectErrors = new Counter('pingpong_connect_errors');
const disconnects = new Counter('pingpong_unexpected_closes');
const published = new Rate('pingpong_published');

const seconds = (duration) => {
    const match = /^(\d+)(s|m)$/.exec(duration);
    return Number(match[1]) * (match[2] === 'm' ? 60 : 1);
};
const total = seconds(RAMP) + seconds(HOLD);

export const options = {
    scenarios: {
        subscribers: {
            executor: 'ramping-vus',
            exec: 'subscriber',
            startVUs: 0,
            stages: [
                { duration: RAMP, target: CONNECTIONS },
                { duration: HOLD, target: CONNECTIONS },
            ],
            gracefulRampDown: '0s',
            gracefulStop: '5s',
        },
        publisher: {
            executor: 'constant-arrival-rate',
            exec: 'publisher',
            startTime: RAMP,
            duration: HOLD,
            rate: RATE,
            timeUnit: '1s',
            preAllocatedVUs: 50,
            maxVUs: 400,
        },
    },
    thresholds: {
        pingpong_connected: ['rate>0.99'],
        pingpong_subscribed: ['rate>0.99'],
        pingpong_published: ['rate>0.99'],
        pingpong_delivery_ms: ['p(95)<500', 'p(99)<1000'],
    },
};

export function subscriber() {
    const channel = `load.${__VU % CHANNELS}`;
    const started = Date.now();
    let opened = false;
    let closing = false;
    const params = ORIGIN ? { headers: { Origin: ORIGIN } } : {};
    const res = ws.connect(WS_URL, params, (socket) => {
        socket.on('message', (frame) => {
            if (frame === '2') {
                socket.send('3'); // Engine.IO ping
            } else if (frame.startsWith('0{')) {
                socket.send(`40${NAMESPACE},${JSON.stringify({ key: KEY })}`);
            } else if (frame.startsWith(`40${NAMESPACE},`)) {
                opened = true;
                connected.add(true);
                socket.send(`42${NAMESPACE},1${JSON.stringify(['subscribe', { channel }])}`);
            } else if (frame.startsWith(`44${NAMESPACE},`)) {
                connectErrors.add(1, { error: frame.slice(NAMESPACE.length + 3) });
                connected.add(false);
                closing = true;
                socket.close();
            } else if (frame.startsWith(`43${NAMESPACE},1`)) {
                const [ack] = JSON.parse(frame.slice(NAMESPACE.length + 4));
                subscribed.add(ack.ok === true);
            } else if (frame.startsWith(`42${NAMESPACE},`)) {
                const [event, payload] = JSON.parse(frame.slice(NAMESPACE.length + 3));
                if (event === 'message' && payload.data && payload.data.sentAt) {
                    delivery.add(Date.now() - payload.data.sentAt);
                    received.add(1);
                }
            }
        });
        socket.on('error', () => {
            if (!opened) connected.add(false);
        });
        socket.on('close', () => {
            if (opened && !closing) disconnects.add(1);
        });
        // Hold the connection until the end of the test: k6 stops the VU itself.
        socket.setTimeout(
            () => {
                closing = true;
                socket.close();
            },
            (total + 30) * 1000 - (Date.now() - started),
        );
    });
    check(res, { 'websocket upgraded': (r) => r && r.status === 101 });
}

export function publisher() {
    const path = '/v1/messages';
    const body = JSON.stringify({
        channels: [`load.${Math.floor(Math.random() * CHANNELS)}`],
        event: 'load.tick',
        data: { sentAt: Date.now(), padding: 'x'.repeat(200) },
    });
    const t = Math.floor(Date.now() / 1000);
    const signature = crypto.hmac(
        'sha256',
        SECRET,
        `${t}.POST.${path}.${crypto.sha256(body, 'hex')}`,
        'hex',
    );
    const res = http.post(`${URL}${path}`, body, {
        headers: {
            'Content-Type': 'application/json',
            'Pingpong-Key': KEY,
            'Pingpong-Signature': `t=${t},v1=${signature}`,
        },
    });
    published.add(res.status >= 200 && res.status < 300);
}

#!/bin/sh
# Runs inside the image: migrates a SQLite database, creates a project, serves, and checks /health,
# the Socket.IO handshake, the admin API and the dashboard. Used by the Docker image workflow.
set -eu

export PINGPONG_DATABASE_URL=sqlite:///var/lib/pingpong/smoke.db
export PINGPONG_SECRET_KEY=0000000000000000000000000000000000000000000000000000000000000000
export PINGPONG_HOST=127.0.0.1
export PINGPONG_ADMIN_TOKEN=smoke-test-admin-token-0123456789abcdef

pingpong migrate
pingpong projects create smoke --origin https://example.com > /dev/null
pingpong doctor
pingpong usage > /dev/null
pingpong serve &
server=$!

for attempt in $(seq 1 50); do
    if node -e "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; then
        break
    fi
    sleep 0.2
done

node -e "
const health = await (await fetch('http://127.0.0.1:3000/health')).json();
if (health.status !== 'ok') throw new Error('health');
const handshake = await (await fetch('http://127.0.0.1:3000/socket.io/?EIO=4&transport=polling')).text();
if (!handshake.startsWith('0{')) throw new Error('handshake: ' + handshake);
const status = await (
    await fetch('http://127.0.0.1:3000/admin/v1/status', {
        headers: { authorization: 'Bearer ' + process.env.PINGPONG_ADMIN_TOKEN },
    })
).json();
if (!status.healthy || status.projects !== 1) throw new Error('admin: ' + JSON.stringify(status));
const page = await fetch('http://127.0.0.1:3000/dashboard/');
const html = await page.text();
if (!page.ok || !page.headers.get('content-security-policy')) throw new Error('dashboard');
const script = /src=\"(\/dashboard\/assets\/[^\"]+\.js)\"/.exec(html)?.[1];
if (script === undefined || !(await fetch('http://127.0.0.1:3000' + script)).ok) {
    throw new Error('dashboard script: ' + script);
}
console.log('Pingpong', status.version, 'answers /health, Socket.IO, the admin API and the dashboard');
" --input-type=module

kill -TERM "$server"
wait "$server"

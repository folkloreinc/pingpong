#!/bin/sh
# Runs inside the image: migrates a SQLite database, creates a project, serves, and checks /health
# and the Socket.IO handshake. Used by the Docker image workflow.
set -eu

export PINGPONG_DATABASE_URL=sqlite:///var/lib/pingpong/smoke.db
export PINGPONG_SECRET_KEY=0000000000000000000000000000000000000000000000000000000000000000
export PINGPONG_HOST=127.0.0.1

pingpong migrate
pingpong projects create smoke --origin https://example.com > /dev/null
pingpong doctor
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
console.log('Pingpong', process.version, 'answers /health and Socket.IO');
" --input-type=module

kill -TERM "$server"
wait "$server"

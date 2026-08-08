#!/bin/sh
# Restarts the production server on :3111 for screenshot verification.
#
# The bracket in the pattern keeps pkill from matching the shell running this
# script — without it, pkill kills its own caller and the step "fails" with a
# signal exit code while the server is still up.
set -e
pkill -f "[n]ext-server" 2>/dev/null || true
pkill -f "[n]ext start" 2>/dev/null || true
sleep 1
cd "$(dirname "$0")/.."
nohup npx next start -p 3111 >/tmp/3dny-server.log 2>&1 &
# Poll rather than sleep a fixed time: a cold start is slower than a warm one.
i=0
while [ $i -lt 40 ]; do
  if curl -sf http://localhost:3111/api/health >/dev/null 2>&1; then
    echo "server up"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done
echo "server did not come up; see /tmp/3dny-server.log" >&2
exit 1

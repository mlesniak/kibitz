#!/usr/bin/env bash
# Deploy kibitz-checker to root@mlesniak.com:/opt/kibitz-checker
# and run setup.sh on the server.
set -euo pipefail

HOST="${1:-root@mlesniak.com}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Syncing to $HOST:/opt/kibitz-checker ..."
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude 'www/status.json' \
  "$DIR"/ "$HOST":/opt/kibitz-checker/

echo "==> Running setup.sh on server ..."
ssh "$HOST" 'bash /opt/kibitz-checker/setup.sh'

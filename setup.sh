#!/usr/bin/env bash
# Idempotent server setup for kibitz-checker.
# Run as root on the server; deploy.sh calls this after rsync.
set -euo pipefail

INSTALL_DIR=/opt/kibitz-checker

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root." >&2
  exit 1
fi

command -v node >/dev/null || { echo "node not found" >&2; exit 1; }
command -v npm  >/dev/null || { echo "npm not found"  >&2; exit 1; }

cd "$INSTALL_DIR"

# Install dependencies
npm ci --omit=dev 2>/dev/null || npm ci

# State + www directories
mkdir -p /var/lib/kibitz-checker
mkdir -p "$INSTALL_DIR/www"

# Seed an empty status.json if none exists yet so the FE doesn't 404
if [[ ! -f "$INSTALL_DIR/www/status.json" ]]; then
  cat > "$INSTALL_DIR/www/status.json" << 'JSON'
{
  "checked_at": null,
  "any_available": false,
  "days": []
}
JSON
fi

# Caddy config
CADDY_CONF=/etc/caddy/Caddyfile.d/kibitz.caddyfile
if [[ ! -f "$CADDY_CONF" ]]; then
  cat > "$CADDY_CONF" << 'CADDY'
kibitz.mlesniak.com {
    root * /opt/kibitz-checker/www
    file_server
}
CADDY
  systemctl reload caddy
  echo "Caddy config written and reloaded."
else
  echo "Caddy config already exists, skipping."
fi

# systemd units
cp systemd/kibitz-checker.service systemd/kibitz-checker.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now kibitz-checker.timer

echo ""
echo "Setup complete."
node --version
echo "Timer status:"
systemctl list-timers kibitz-checker.timer --no-pager

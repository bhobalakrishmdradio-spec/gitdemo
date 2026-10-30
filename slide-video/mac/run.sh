#!/bin/bash
# Started by launchd at login (see install.sh). Runs the SlideCast server.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# launchd starts with a bare PATH; ffmpeg and espeak-ng live in Homebrew.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
set -a
# shellcheck disable=SC1091
. "$HOME/.slidecast/config.env"
set +a

cd "$APP_DIR"
# --proxy-headers lets `tailscale serve` (which proxies from 127.0.0.1) pass the
# real https scheme and client address through.
exec "$APP_DIR/.venv/bin/python" -m uvicorn app.main:app \
    --host "${SLIDECAST_HOST:-127.0.0.1}" --port "${SLIDECAST_PORT:-8000}" \
    --proxy-headers --forwarded-allow-ips 127.0.0.1

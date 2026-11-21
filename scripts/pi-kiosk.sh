#!/usr/bin/env bash
# Run HEAT STACK full-screen on a Raspberry Pi (Pi 4/5, Raspberry Pi OS with desktop).
# Usage: ./scripts/pi-kiosk.sh [port]
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8137}"
python3 scripts/serve.py "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1
BROWSER="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$BROWSER" ]; then echo "Chromium not found: sudo apt install chromium-browser"; exit 1; fi
# GPU rasterisation + WebGL on the VideoCore GPU. The game auto-drops to Canvas 2D if WebGL is too slow.
"$BROWSER" --kiosk --noerrdialogs --disable-infobars --enable-gpu-rasterization --ignore-gpu-blocklist \
  --autoplay-policy=no-user-gesture-required "http://127.0.0.1:$PORT/"

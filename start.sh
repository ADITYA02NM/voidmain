#!/usr/bin/env bash
# VoidMain launcher — laptop 1 runs everything (broker, backend, bus director, web).
# Prints the 3-laptop demo banner: dashboard URL, debug console URL, LAN code.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD="$ROOT/dashboard"

# ---- LAN identity (laptop 2/3 open http://<this-ip>:8081) ----
LAN_IP="$(ip -4 -o addr show scope global 2>/dev/null \
  | awk '$2 ~ /^(wlan|enp|ens|eth)/ {split($4,a,"/"); print a[1]; exit}')"
[ -z "$LAN_IP" ] && LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$LAN_IP" ] && LAN_IP="127.0.0.1"

# One stable code for the whole rig (regenerate by deleting .demo-code).
if [ -z "${VOIDMAIN_DEMO_CODE:-}" ]; then
  DEMO_CODE="$(cat "$ROOT/.demo-code" 2>/dev/null || true)"
  if [ -z "$DEMO_CODE" ]; then
    DEMO_CODE="$(od -An -N4 -tx4 /dev/urandom | tr -d ' \n' | tr 'a-f' 'A-F')"
    printf '%s' "$DEMO_CODE" > "$ROOT/.demo-code"
  fi
else
  DEMO_CODE="$VOIDMAIN_DEMO_CODE"
fi

echo "[1/5] Mosquitto MQTT broker (0.0.0.0:1883 — LAN-open for the ESP32)..."
MOSQ_DIR="${TMPDIR:-/tmp}/voidmain-mosq"
mkdir -p "$MOSQ_DIR"
cat > "$MOSQ_DIR/mosquitto.conf" <<CONF
listener 1883 0.0.0.0
allow_anonymous true
CONF
pkill mosquitto 2>/dev/null || true
sleep 0.5
mosquitto -c "$MOSQ_DIR/mosquitto.conf" -d
sleep 1

# ---- backend env: LAN origins, debug console, demo code, evidence log ----
export VOIDMAIN_HTTP_PORT=8080
export VOIDMAIN_ALLOW_LAN=1
export VOIDMAIN_DEBUG=1
export VOIDMAIN_DEMO_CODE="$DEMO_CODE"
export VOIDMAIN_EVIDENCE_DB="${VOIDMAIN_EVIDENCE_DB:-$DASHBOARD/evidence.db}"
export VOIDMAIN_ORIGINS="http://localhost:5173,http://localhost:8080,http://127.0.0.1:8080,http://$LAN_IP:8080"

echo "[2/5] Frontend build (this is what laptop 2/3 load on :8081)..."
if [ ! -f "$DASHBOARD/web/dist/index.html" ]; then
  (cd "$DASHBOARD/web" && npm run build) \
    || echo "  ! build failed — laptop 2/3 will 404 (run: cd web && npm run build)"
fi

echo "[3/5] Backend (port 8080)..."
pkill -f "server.main" 2>/dev/null || true
sleep 0.5
cd "$DASHBOARD"
"$DASHBOARD/venv/bin/python" -c "from server.main import main; main()" \
  > /tmp/voidmain-server.log 2>&1 &
BACKEND_PID=$!
echo "  Backend PID=$BACKEND_PID"

echo "[4/5] Bus director (dev-only event feed, idle until a trigger)..."
pkill -f "tools/mock_feed" 2>/dev/null || true
"$DASHBOARD/venv/bin/python" -u "$DASHBOARD/tools/mock_feed.py" \
  --host 127.0.0.1 --port 1883 --no-auto > /tmp/voidmain-mockfeed.log 2>&1 &
echo "  Director PID=$!"

echo "[5/5] Vite dev server (laptop 1 only, :5173)..."
pkill -f "vite" 2>/dev/null || true
sleep 0.3
cd "$DASHBOARD/web"
npm run dev > /tmp/voidmain-vite.log 2>&1 &
echo "  Vite PID=$!"

sleep 3
echo
echo "============================================================"
echo "  VoidMain demo stack — laptop 1 (brain + Minecraft)"
echo "============================================================"
echo "  Dashboard  (laptop 2)    http://$LAN_IP:8080/"
echo "  Console    (laptop 3)    http://$LAN_IP:8080/debug.html"
echo "  Alerts     (phone)       http://$LAN_IP:8080/alerts"
echo "  Dev view   (this laptop) http://localhost:5173"
echo "  LAN access code          $DEMO_CODE"
echo "  MQTT host for config.h   $LAN_IP  (port 1883)"
echo "------------------------------------------------------------"
curl -s http://127.0.0.1:8080/healthz | python3 -m json.tool 2>/dev/null \
  || echo "  Backend not ready yet — check /tmp/voidmain-server.log"
echo "  Logs: /tmp/voidmain-server.log /tmp/voidmain-mockfeed.log /tmp/voidmain-vite.log"
echo "============================================================"
echo "Press Ctrl+C to stop the backend (others keep running)."
wait $BACKEND_PID

#!/usr/bin/env bash
# VoidMain launcher — starts all services and keeps them running
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD="$ROOT/dashboard"

echo "[1/4] Mosquitto MQTT broker..."
pkill mosquitto 2>/dev/null || true
sleep 0.5
mosquitto -p 1883 -d
sleep 1

echo "[2/4] Backend (port 8081)..."
pkill -f "server.main" 2>/dev/null || true
sleep 0.5
cd "$DASHBOARD"
VOIDMAIN_HTTP_PORT=8081 "$DASHBOARD/venv/bin/python" -c "from server.main import main; main()" \
  > /tmp/voidmain-server.log 2>&1 &
BACKEND_PID=$!
echo "  Backend PID=$BACKEND_PID"
sleep 2

echo "[3/4] Mock IoT feed..."
pkill -f "mock_feed" 2>/dev/null || true
"$DASHBOARD/venv/bin/python" "$DASHBOARD/tools/mock_feed.py" \
  > /tmp/voidmain-mockfeed.log 2>&1 &
echo "  Mock feed PID=$!"

echo "[4/4] Vite dev server (port 5173)..."
pkill -f "vite" 2>/dev/null || true
sleep 0.3
cd "$DASHBOARD/web"
npm run dev > /tmp/voidmain-vite.log 2>&1 &
VITE_PID=$!
echo "  Vite PID=$VITE_PID"
sleep 3

echo ""
echo "=== VoidMain Stack ==="
curl -s http://127.0.0.1:8081/healthz | python3 -m json.tool 2>/dev/null || echo "Backend not ready yet — check /tmp/voidmain-server.log"
echo ""
echo "  Dashboard:  http://localhost:5173"
echo "  Backend:    http://localhost:8081"
echo "  Logs:       /tmp/voidmain-server.log"
echo "              /tmp/voidmain-vite.log"
echo ""
echo "Press Ctrl+C to stop all services."
wait $BACKEND_PID

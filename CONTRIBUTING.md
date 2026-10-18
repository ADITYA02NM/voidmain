# Contributing to VoidMain

Thanks for looking. VoidMain is a **local-only** IoT coordination system — no
cloud, no external services in the control path. Keep that invariant in mind for
every change.

## Repository layout

| Path | What lives here |
|---|---|
| `dashboard/server/` | aiohttp backend: MQTT bridge, auth, SQLite evidence, WS hub, console RAG |
| `dashboard/web/` | React + TypeScript operator console (Vite) |
| `dashboard/tools/` | Scenario publisher + evidence generator (dev only) |
| `firmware/esp32-risk-mini/` | ESP32-C3 firmware (PlatformIO: OLED + NeoPixel risk mirror) |
| `docs/` | Product brief, run-of-show, slide deck |
| `assets/` | Banner + architecture SVGs |

## Before you open a PR

Run the same checks CI runs:

```bash
# backend
cd dashboard
pip install -r requirements-dev.txt
pytest -q

# frontend
cd dashboard/web
npm ci
npm run build      # tsc --noEmit + vite build
npm test           # vitest

# firmware (only if you touched it)
cd firmware/esp32-risk-mini
pio run -e esp32c3-supermini
```

## Conventions

- **Smallest correct diff.** Fix root causes, not symptoms.
- **Design tokens only in CSS.** `dashboard/web/src/styles/tokens.css` is the
  single source of raw colours/spacings; components use `var(--…)`. The
  `token-lint` vitest enforces this.
- **No secrets, no cloud calls.** Auth, scoring, and automation stay on the LAN.
- **Label simulated data.** Anything synthetic (mock feed, replay, debug
  triggers) must be visibly marked as simulated — never presented as hardware
  validation.
- **Commit style:** `area: short imperative summary` (e.g. `firmware: resolve
  broker via mDNS`, `sim: add coordinated PURPLE automation beat`).

## Reporting issues

Use the bug-report template. Include the component, your OS, and the relevant
log (`/tmp/voidmain-server.log`, browser console, or ESP32 serial at 115200).

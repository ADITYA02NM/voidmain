# Changelog

All notable changes to VoidMain are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Firmware resolves the MQTT broker by **mDNS** (`archlinux.local`) with a
  compiled-in fallback, so the board survives the host's IP changing.
- CI workflow covering backend tests, frontend typecheck/build/tests, and the
  PlatformIO firmware build.
- README Credits section naming the **Farlands 48-hour Hardware × Software
  Hackathon** and its host, **Cambridge Institute of Technology**, plus an
  explicit License section.

### Changed
- `## Demo` moved to the end of the README, with an inline animated preview
  (`media/demo.gif`) because GitHub strips `<video>` tags in repo context.
- `LICENSE` copyright holder now reads *Aditya Gowda (VoidMain)*.

## [0.5.0] — Farlands build

### Added
- **Local console assistant** — in-process BM25 retrieval over the repo's own
  docs plus a local Ollama model; degrades to a retrieval-only reply when the
  model is unavailable. Zero cloud.
- **Debug console + trigger remote** (`/debug.html`) — session-gated WebSocket
  inspector that drives devices, alerts, score, band, health, and the ESP32 LED.
- **Alert phone page** (`/alerts`) — phone-friendly standalone alert feed.
- **Scenario publisher** — full `GREEN → YELLOW → RED → PURPLE → decay` replay,
  with pause/hold, reset, and hard-refresh persistence.
- **Evidence database** — pre-populated 30-day score history and alert archive,
  replayed to any browser that joins mid-session.

### Changed
- Consolidated the IoT fleet into a focused, coordinated device set
  (campfire, air purifier, front door, front camera, perimeter/smoke).
- ESP32-C3 firmware: boot "eyes" animation, then a live risk scoreboard with
  per-node health boxes and a band-coloured NeoPixel.

### Fixed
- Simulation continuity across pause/resume; RESET now restores the whole board.

## [0.4.0] — Coordination core

### Added
- Risk engine: many sensors → one deterministic 0–100 score → colour band.
- Coordinated automation on the PURPLE band (locks, cameras, purifier, fire
  suppression) driven by multi-sensor fusion rather than single thresholds.
- WebAuthn owner enrollment, session-gated WebSockets, and an audit trail.

## [0.3.0] — Operator console

### Added
- React + TypeScript operator dashboard: live event feed, risk panel, node
  tiles, IoT topology, alert feed with ACK, command console, and history chart.
- MQTT ↔ WebSocket bridge with self-reconnecting backoff.

"""Demo trigger catalogue — one source of truth for voidmain/sim/* messages.

The dashboard never authors voidmain/risk/# (see main.py). A trigger is only a
*request*: the server relays `voidmain/sim/<id>` and the dev-only bus director
(tools/mock_feed.py) executes it by publishing the real event stream, so the
operator dashboard, the debug console and the ESP32 OLED all move together.

Three consumers import this module:
  * server/main.py  — allowlists ids accepted from the debug console
  * tools/mock_feed.py — executes them on the bus
  * GET /debug/triggers — hands the button catalogue to debug.html
"""

from __future__ import annotations

SEVS: tuple[str, ...] = ("green", "yellow", "red", "purple")
ALERT_SEVS: tuple[str, ...] = ("info", "yellow", "red", "purple")
NODES: tuple[str, ...] = ("pi4", "pi3a", "pi3b")  # esp32 is real hardware

# Band buttons are score targets — band is derived from score on the bus.
BAND_PRESETS: dict[str, int] = {"GREEN": 10, "YELLOW": 45, "RED": 70, "PURPLE": 90}
SCORE_PRESETS: tuple[int, ...] = (0, 10, 25, 45, 65, 75, 90, 100)

GROUPS: tuple[str, ...] = ("story", "score", "alert", "device", "health", "edge", "preset")

# Ready-made demo sequences that laptop 3 can fire in one press.
# Each preset is a voidmain/sim/<id> the bus director (mock_feed.py) executes.
# The server relays these like any other trigger — it still never writes
# voidmain/risk/# directly, so dashboard + debug console + ESP32 stay in sync.

PRESETS: tuple[dict, ...] = (
    {"id": "preset/green-warm", "group": "preset",
     "label": "GREEN · warm baseline",
     "hint": "Score 10, all 5 devices GREEN, nodes up."},
    {"id": "preset/green-idle", "group": "preset",
     "label": "GREEN · quiet idle",
     "hint": "Score 3, heartbeat only."},
    {"id": "preset/yellow-motion", "group": "preset",
     "label": "YELLOW · perimeter + environmental",
     "hint": "Perimeter sensor after hours, air purifier filter low."},
    {"id": "preset/red-intrusion", "group": "preset",
     "label": "RED · intrusion (door + camera + perimeter)",
     "hint": "Front door opened unexpectedly + camera person detection + perimeter breach."},
    {"id": "preset/purple-automation", "group": "preset",
     "label": "PURPLE · automation executed",
     "hint": "Door locked, camera high-res, air purifier boosted, campfire extinguished, perimeter secured."},
    {"id": "preset/full-tour", "group": "preset",
     "label": "FULL TOUR · GREEN→YELLOW→RED→PURPLE→GREEN",
     "hint": "Plays the whole colour story, then resets to GREEN."},
    {"id": "preset/ack-story", "group": "preset",
     "label": "ACK last alert",
     "hint": "Acknowledges the newest open alert on every screen."},
    {"id": "preset/failure-node-down", "group": "preset",
     "label": "Failure · pi3a goes silent",
     "hint": "Stops pi3a heartbeats; tile ages yellow at 15s, red at 30s."},
    {"id": "preset/failure-node-up", "group": "preset",
     "label": "Failure · pi3a recovers",
     "hint": "Restores pi3a heartbeat."},
    {"id": "preset/edge-ids", "group": "preset",
     "label": "Edge · IDS + rogue AP",
     "hint": "Unknown LAN device, rogue AP, Suricata signature."},
    {"id": "preset/esp32-led-cycle", "group": "preset",
     "label": "ESP32 LED cycle · green/yellow/red/purple",
     "hint": "Drives the ESP32 NeoPixel through all four band colours."},
)

PRESET_IDS: frozenset[str] = frozenset(p["id"] for p in PRESETS)


def band_for_score(score: int) -> str:
    """Same thresholds as the dashboard's bands.ts and the ESP32 LED."""
    if score >= 85:
        return "PURPLE"
    if score >= 60:
        return "RED"
    if score >= 30:
        return "YELLOW"
    return "GREEN"


# ── IoT devices (5) — the base seed AND the debug console's buttons ───────────
# Fleet: campfire, air-purifier, door-front, camera-front, perimeter.
# The perimeter integrity sensor is the second environmental detection source
# in the YELLOW/RED story so the demo keeps a coherent multi-sensor trigger
# without carrying a sixth device.
DEVICES: tuple[dict, ...] = (
    {"id": "campfire", "name": "Campfire", "kind": "extinguish", "room": "Backyard",
     "states": {"green": {"state": "Burning", "burning": True},
                "yellow": {"state": "Waning", "burning": True},
                "red": {"state": "Smoldering", "burning": False},
                "purple": {"state": "Extinguished", "burning": False,
                           "automation": "Campfire extinguished by automation"}}},
    {"id": "air-purifier", "name": "Air Purifier", "kind": "purifier", "room": "Living Room",
     "states": {"green": {"state": "On auto", "on": True},
                "yellow": {"state": "Filter low", "on": True},
                "red": {"state": "Off", "on": False},
                "purple": {"state": "Boosted", "on": True,
                           "automation": "Air purifier boosted"}}},
    {"id": "door-front", "name": "Front Door", "kind": "lock", "room": "Entrance",
     "states": {"green": {"state": "Locked", "locked": True},
                "yellow": {"state": "Ajar", "locked": False},
                "red": {"state": "Opened unexpectedly", "locked": False},
                "purple": {"state": "Auto-locked", "locked": True,
                           "automation": "Door locked remotely"}}},
    {"id": "camera-front", "name": "Front Camera", "kind": "camera", "room": "Entrance",
     "states": {"green": {"state": "Armed recording", "on": True},
                "yellow": {"state": "Motion clip saved", "on": True},
                "red": {"state": "Person detected", "on": True},
                "purple": {"state": "High-res recording", "on": True,
                           "automation": "Camera switched to high-res"}}},
    {"id": "perimeter", "name": "Perimeter Sensor", "kind": "perimeter", "room": "Yard",
     "states": {"green": {"state": "Clear"},
                "yellow": {"state": "Motion after hours"},
                "red": {"state": "Perimeter breached"},
                "purple": {"state": "Perimeter secured", "automation": "Perimeter integrity restored"}}},
    {"id": "smoke-detector", "name": "Smoke Detector", "kind": "smoke", "room": "Kitchen",
     "states": {"green": {"state": "Clear"},
                "yellow": {"state": "Haze detected"},
                "red": {"state": "Smoke alarm sounding"},
                "purple": {"state": "Suppression active", "automation": "Fire suppression deployed"}}},
)

DEVICE_IDS: frozenset[str] = frozenset(d["id"] for d in DEVICES)


def device_payload(dev_id: str, sev: str, ts: int) -> dict:
    """MQTT payload for voidmain/device/<id> — used by the seed AND the director."""
    dev = next(d for d in DEVICES if d["id"] == dev_id)
    st = dev["states"][sev]
    payload: dict = {"id": dev["id"], "name": dev["name"], "kind": dev["kind"],
                     "room": dev["room"], "sev": sev, "state": st["state"], "ts": ts}
    for key in ("locked", "on", "automation"):
        if key in st:
            payload[key] = st[key]
    return payload


# ── Alerts ──────────────────────────────────────────────────────────────────
ALERT_PRESETS: dict[str, dict] = {
    "info": {"title": "Routine check — all sensors nominal", "src": "risk/engine",
             "body": "Scheduled sweep: no anomalies in the current window."},
    "yellow": {"title": "Unusual activity detected", "src": "iot/motion-hall",
               "body": "Motion pattern outside the learned schedule — flagged for review."},
    "red": {"title": "Intrusion alert — door + camera", "src": "iot/door-front",
            "body": "Front door opened unexpectedly with camera person detection."},
    "purple": {"title": "Automation executed — home secured", "src": "iot/auto",
               "body": "Doors locked, lights on, cameras high-res, garage closed."},
}

STORY_ALERTS: dict[str, dict] = {
    "alert-intrusion": {"sev": "red", "title": "Intrusion alert — door + camera",
                        "src": "iot/door-front",
                        "body": "Front door opened + camera person detection. Alert sent to owner."},
    "alert-leak": {"sev": "yellow", "title": "Water leak under sink", "src": "iot/leak-utility",
                   "body": "Moisture sensor triggered — utility room. Check plumbing."},
    "alert-node-down": {"sev": "yellow", "title": "Node pi3a heartbeat lost", "src": "health/pi3a",
                        "body": "No heartbeat from sensor node for 15s — tile will age."},
    "alert-automation": {"sev": "purple", "title": "Automation executed — home secured",
                         "src": "iot/auto",
                         "body": "Doors locked, lights on, cameras active, garage closed."},
}

# ── Edge / IDS events ───────────────────────────────────────────────────────
EDGE_EVENTS: dict[str, dict] = {
    "lan-unknown": {"mac": "de:ad:be:ef:12:34", "ip": "10.10.1.66",
                    "vendor": "", "known": False,
                    "title": "Unknown device on the LAN"},
    "lan-known": {"mac": "b8:27:eb:44:11:22", "ip": "10.10.1.31",
                  "vendor": "Raspberry Pi", "known": True,
                  "title": "Known device joined"},
    "wifi-rogue": {"mac": "02:00:00:aa:bb:cc", "ssid": "Free_WiFi",
                   "sev": "yellow", "title": "Rogue AP detected"},
    "suricata": {"signature": "ET EXPLOIT possible shellcode download",
                 "severity": "red", "src_ip": "10.10.1.66",
                 "dest_ip": "10.10.8.97", "sig_id": 2034567},
    "tripwire": {"node": "pi3a", "edge": "open"},
}

# ── Trigger list handed to the debug console ────────────────────────────────
TRIGGERS: tuple[dict, ...] = (
    {"id": "start", "group": "story", "label": "Run scripted tour"},
    {"id": "stop", "group": "story", "label": "Stop scripted tour"},
    {"id": "score", "group": "score", "label": "Set risk score"},
    {"id": "alert", "group": "alert", "label": "New alert"},
    {"id": "alert-intrusion", "group": "alert", "label": "Intrusion alert"},
    {"id": "alert-leak", "group": "alert", "label": "Water leak alert"},
    {"id": "alert-node-down", "group": "alert", "label": "Node heartbeat lost"},
    {"id": "alert-automation", "group": "alert", "label": "Automation executed"},
    {"id": "device", "group": "device", "label": "Device state"},
    {"id": "health", "group": "health", "label": "Node heartbeat"},
    {"id": "lan-unknown", "group": "edge", "label": "Unknown LAN device"},
    {"id": "lan-known", "group": "edge", "label": "Known LAN device"},
    {"id": "wifi-rogue", "group": "edge", "label": "Rogue AP"},
    {"id": "suricata", "group": "edge", "label": "Suricata IDS alert"},
    {"id": "tripwire", "group": "edge", "label": "Segment tripwire open"},
    {"id": "sim/esp32-led", "group": "device", "label": "ESP32 LED colour (tinysim)"},
    {"id": "sim/esp32-led-cycle", "group": "device", "label": "ESP32 LED cycle green/yellow/red/purple"},
)

TRIGGER_IDS: frozenset[str] = frozenset(t["id"] for t in TRIGGERS)


def validate(tid: str, v: object = None, s: object = None) -> tuple[bool, str]:
    """Allowlist + payload check. Returns (ok, reason-for-400)."""
    if tid not in TRIGGER_IDS | PRESET_IDS:
        return False, f"unknown trigger: {tid!r}"
    if tid == "score":
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= 100:
            return False, "score needs v as an int 0..100"
    elif tid == "alert":
        if v not in ALERT_SEVS:
            return False, f"alert needs v in {ALERT_SEVS}"
    elif tid == "device":
        if v not in DEVICE_IDS:
            return False, f"unknown device: {v!r}"
        if s not in SEVS:
            return False, f"device needs s in {SEVS}"
    elif tid == "health":
        # health triggers are for node heartbeats (pi4/pi3a/pi3b/esp32),
        # not for IoT devices.
        if v not in NODES:
            return False, f"health needs v in {NODES}"
        if s not in ("up", "down"):
            return False, "health needs s=up|down"
    elif tid == "iot":
        # IoT device trigger: v is the device id, s is the desired severity.
        if v not in DEVICE_IDS:
            return False, f"unknown device: {v!r}"
        if s not in SEVS:
            return False, f"device needs s in {SEVS}"
    elif tid.startswith("preset/"):
        if v not in (None, 0, ""):
            return False, "presets take no v/s — they are fixed sequences"
    elif tid == "sim/esp32-led":
        if s not in SEVS:
            return False, f"sim/esp32-led needs s in {SEVS}"
    elif tid == "sim/esp32-led-cycle":
        if v not in (None, 0, ""):
            return False, "sim/esp32-led-cycle takes no payload"
    return True, ""


def catalogue() -> dict:
    """Everything debug.html needs to build its buttons — no duplicated lists."""
    return {
        "groups": list(GROUPS),
        "triggers": [dict(t) for t in TRIGGERS],
        "presets": [dict(p) for p in PRESETS],
        "esp32_led_sevs": list(SEVS),
        "devices": [
            {"id": d["id"], "name": d["name"], "kind": d["kind"], "room": d["room"],
             "states": {sev: d["states"][sev]["state"] for sev in SEVS}}
            for d in DEVICES
        ],
        "sevs": list(SEVS),
        "alert_sevs": list(ALERT_SEVS),
        "band_presets": dict(BAND_PRESETS),
        "score_presets": list(SCORE_PRESETS),
        "nodes": list(NODES),
    }

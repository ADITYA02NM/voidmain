#!/usr/bin/env python3
"""VoidMain dev-only scenario publisher.

DEV-ONLY. Never started by systemd. Publishes to the REAL broker so the whole
path (mosquitto -> server.py -> WebSocket -> browser) is exercised end to end.

Replays the IoT smart-home demo:
    1. quiet GREEN — all devices seeded normal
    2. unusual activity (YELLOW): motion, thermostat, leak
    3. intrusion alert (RED): door open + smoke + camera person
    4. automation (PURPLE): locks, lights, cameras, garage
    5. decay back to GREEN
Plus failure beats: a node goes silent (stops publishing health), then the
operator is told to kill Mosquitto to watch the header go STALE/OFFLINE.

Note: this mock plays the role of BOTH the IoT sensors AND the Pi4 risk
engine (it publishes voidmain/risk/# too) purely so a laptop with no hardware
can see the full dashboard. On real hardware this tool is never run.

Usage:
    pip install paho-mqtt
    python mock_feed.py --host 127.0.0.1 --port 1883 [--user dev --pass dev]
"""

from __future__ import annotations

import argparse
import json
import sys
import time

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("mock_feed needs paho-mqtt:  pip install paho-mqtt", file=sys.stderr)
    raise SystemExit(1)

BANNER = r"""
============================================================
  VoidMain MOCK FEED  -  DEV-ONLY  -  DO NOT RUN IN PRODUCTION
  Publishes synthetic IoT events to the live broker for demos.
============================================================
"""


def band_for(score: int) -> str:
    if score >= 85:
        return "PURPLE"
    if score >= 60:
        return "RED"
    if score >= 30:
        return "YELLOW"
    return "GREEN"


class Feed:
    def __init__(self, host: str, port: int, user: str | None, password: str | None) -> None:
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="voidmain-mock")
        if user:
            self.client.username_pw_set(user, password or "")
        self.client.connect(host, port, keepalive=30)
        self.client.loop_start()
        self._n = 0

    def pub(self, topic: str, payload: dict | str | int, retain: bool = False) -> None:
        data = payload if isinstance(payload, str) else json.dumps(payload)
        self.client.publish(topic, data, qos=1, retain=retain)
        print(f"  -> {topic:26s} {data}")

    def health(self, nodes: tuple[str, ...] = ("pi4", "pi3a", "pi3b")) -> None:
        for node in nodes:
            self.pub(f"voidmain/health/{node}",
                     {"node": node, "up": 3600 + self._n * 10,
                      "services": ["ok"]})
        self._n += 1

    def risk(self, score: int) -> None:
        score = max(0, min(100, score))
        self.pub("voidmain/risk/score", {"v": score}, retain=True)
        self.pub("voidmain/risk/band", {"b": band_for(score)}, retain=True)

    def alert(self, aid: str, sev: str, title: str, src: str, body: str) -> None:
        self.pub(f"voidmain/alert/{aid}",
                 {"id": aid, "sev": sev, "title": title, "src": src,
                  "body": body, "ts": int(time.time()), "ack": False})

    def device(self, did: str, name: str, kind: str, room: str, sev: str, state: str, **kw) -> None:
        payload = {"id": did, "name": name, "kind": kind, "room": room,
                   "sev": sev, "state": state, "ts": int(time.time()), **kw}
        self.pub(f"voidmain/device/{did}", payload)

    def seed_devices(self) -> None:
        print("  seeding IoT devices (all GREEN)")
        self.device("door-front", "Front Door", "lock", "Entrance", "green", "Locked", locked=True)
        self.device("door-back", "Back Door", "lock", "Kitchen", "green", "Locked", locked=True)
        self.device("light-living", "Living Light", "light", "Living Room", "green", "On", on=True)
        self.device("light-bedroom", "Bedroom Light", "light", "Bedroom", "green", "Off", on=False)
        self.device("light-porch", "Porch Light", "light", "Entrance", "green", "Off", on=False)
        self.device("thermostat", "Thermostat", "thermostat", "Hallway", "green", "21C heat")
        self.device("garage", "Garage Door", "garage", "Garage", "green", "Closed", locked=True)
        self.device("plug-coffee", "Coffee Plug", "plug", "Kitchen", "green", "On", on=True)
        self.device("plug-desk", "Desk Plug", "plug", "Office", "green", "On", on=True)
        self.device("motion-hall", "Hall Motion", "motion", "Hallway", "green", "Clear")
        self.device("motion-yard", "Yard Motion", "motion", "Yard", "green", "Clear")
        self.device("smoke-kitchen", "Kitchen Smoke", "smoke", "Kitchen", "green", "Clear")
        self.device("leak-utility", "Utility Leak", "leak", "Utility", "green", "Dry")
        self.device("camera-front", "Front Camera", "camera", "Entrance", "green", "Armed recording", on=True)
        self.device("camera-yard", "Yard Camera", "camera", "Yard", "green", "Armed recording", on=True)
        self.device("purifier", "Air Purifier", "purifier", "Living Room", "green", "On auto", on=True)
        self.device("curtain", "Bedroom Curtain", "curtain", "Bedroom", "green", "Closed", on=False)

    def iot_scenario(self) -> None:
        print("  IoT YELLOW — unusual activity")
        self.device("motion-hall", "Hall Motion", "motion", "Hallway", "yellow", "Motion after hours")
        self.device("motion-yard", "Yard Motion", "motion", "Yard", "yellow", "Motion after hours")
        self.device("thermostat", "Thermostat", "thermostat", "Hallway", "yellow", "24C rising")
        self.device("leak-utility", "Utility Leak", "leak", "Utility", "yellow", "Moisture detected")
        self.alert("iot-yellow-1", "yellow", "Unusual motion detected",
                   "iot/motion-hall", "Hall + yard motion triggered at 02:14 — no one home.")
        time.sleep(2)
        print("  IoT RED — intrusion alert")
        self.device("door-front", "Front Door", "lock", "Entrance", "red", "Opened unexpectedly", locked=False)
        self.device("smoke-kitchen", "Kitchen Smoke", "smoke", "Kitchen", "red", "Smoke threshold exceeded")
        self.device("camera-front", "Front Camera", "camera", "Entrance", "red", "Person detected", on=True)
        self.device("camera-yard", "Yard Camera", "camera", "Yard", "red", "Person detected", on=True)
        self.alert("iot-red-1", "red", "Intrusion alert — door + camera",
                   "iot/door-front", "Front door opened + camera person detection. Alert sent to owner.")
        time.sleep(2)
        print("  IoT PURPLE — automation executed")
        self.device("door-front", "Front Door", "lock", "Entrance", "purple", "Auto-locked",
                    locked=True, automation="Locked door remotely")
        self.device("door-back", "Back Door", "lock", "Kitchen", "purple", "Auto-locked",
                    locked=True, automation="Locked back door")
        self.device("light-living", "Living Light", "light", "Living Room", "purple", "All lights ON",
                    on=True, automation="Turned on all lights")
        self.device("light-bedroom", "Bedroom Light", "light", "Bedroom", "purple", "All lights ON",
                    on=True, automation="Turned on all lights")
        self.device("light-porch", "Porch Light", "light", "Entrance", "purple", "All lights ON",
                    on=True, automation="Turned on porch light")
        self.device("camera-front", "Front Camera", "camera", "Entrance", "purple", "High-res recording",
                    on=True, automation="Switched to high-res recording")
        self.device("camera-yard", "Yard Camera", "camera", "Yard", "purple", "High-res recording",
                    on=True, automation="Switched to high-res recording")
        self.device("garage", "Garage Door", "garage", "Garage", "purple", "Locked",
                    locked=True, automation="Garage secured")
        self.alert("iot-purple-1", "purple", "Automation executed — home secured",
                   "iot/auto", "Doors locked, lights on, cameras high-res, garage closed.")
        time.sleep(3)
        print("  IoT GREEN — recovery")
        self.device("door-front", "Front Door", "lock", "Entrance", "green", "Locked", locked=True)
        self.device("door-back", "Back Door", "lock", "Kitchen", "green", "Locked", locked=True)
        self.device("light-living", "Living Light", "light", "Living Room", "green", "On", on=True)
        self.device("light-bedroom", "Bedroom Light", "light", "Bedroom", "green", "Off", on=False)
        self.device("light-porch", "Porch Light", "light", "Entrance", "green", "Off", on=False)
        self.device("thermostat", "Thermostat", "thermostat", "Hallway", "green", "21C heat")
        self.device("garage", "Garage Door", "garage", "Garage", "green", "Closed", locked=True)
        self.device("motion-hall", "Hall Motion", "motion", "Hallway", "green", "Clear")
        self.device("motion-yard", "Yard Motion", "motion", "Yard", "green", "Clear")
        self.device("smoke-kitchen", "Kitchen Smoke", "smoke", "Kitchen", "green", "Clear")
        self.device("camera-front", "Front Camera", "camera", "Entrance", "green", "Armed recording", on=True)
        self.device("camera-yard", "Yard Camera", "camera", "Yard", "green", "Armed recording", on=True)

    def stop(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()


def run(feed: Feed) -> None:
    print("\n[1] quiet GREEN — seed all IoT devices")
    feed.seed_devices()
    for i in range(3):
        feed.health()
        feed.risk(4 + i)
        time.sleep(2)

    print("\n[2] IoT scenario: yellow -> red -> purple -> green")
    feed.iot_scenario()
    feed.risk(70)
    feed.health()
    time.sleep(2)

    print("\n[3] residual PURPLE then decay")
    feed.risk(88)
    feed.alert("crit-1", "purple", "Critical: sustained intrusion",
               "risk/engine", "Score crossed PURPLE (85). Operator paged.")
    time.sleep(2)
    feed.risk(40)
    feed.health()
    time.sleep(2)

    print("\n[4] decay back to GREEN (-8 / 1.5s modelled fast)")
    s = 40
    while s > 4:
        s = max(0, s - 8)
        feed.risk(s)
        feed.health()
        time.sleep(1.5)

    print("\n[5] failure beat: Pi3a goes silent (no more health)")
    for _ in range(4):
        feed.health(nodes=("pi4", "pi3b"))  # pi3a omitted -> tile ages to red
        feed.risk(4)
        time.sleep(3)

    print("\n[6] Now KILL mosquitto to watch the header go STALE/OFFLINE:")
    print("      sudo systemctl stop mosquitto   (Ctrl-C here when done)")
    while True:
        feed.health(nodes=("pi4", "pi3b"))
        feed.risk(3)
        time.sleep(5)


def main() -> None:
    ap = argparse.ArgumentParser(description="VoidMain dev-only mock feed")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--user", default=None)
    ap.add_argument("--pass", dest="password", default=None)
    ap.add_argument("--script", default="demo", choices=["demo"],
                    help="scenario to replay (IoT smart-home demo)")
    args = ap.parse_args()

    print(BANNER)
    feed = Feed(args.host, args.port, args.user, args.password)
    try:
        run(feed)
    except KeyboardInterrupt:
        print("\nstopping mock feed.")
    finally:
        feed.stop()


if __name__ == "__main__":
    main()

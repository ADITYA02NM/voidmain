#!/usr/bin/env python3
"""ULTRON dev-only scenario publisher.

DEV-ONLY. Never started by systemd. Publishes to the REAL broker so the whole
path (mosquitto -> server.py -> WebSocket -> browser) is exercised end to end.

Replays the README 4-minute demo:
    1. quiet GREEN
    2. unknown LAN device joins
    3. tripwire pi3a opens
    4. Suricata burst drives score RED then PURPLE
    5. decay back to GREEN
Plus failure beats: a node goes silent (stops publishing health), then the
operator is told to kill Mosquitto to watch the header go STALE/OFFLINE.

Note: this mock plays the role of BOTH the detection nodes AND the Pi4 risk
engine (it publishes ultron/risk/# too) purely so a laptop with no Pis can see
the full dashboard. On real hardware, Pi4's sentinel-risk owns risk/# and this
tool is never run.

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
  ULTRON MOCK FEED  -  DEV-ONLY  -  DO NOT RUN IN PRODUCTION
  Publishes synthetic events to the live broker for demos.
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
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="ultron-mock")
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
            self.pub(f"ultron/health/{node}",
                     {"node": node, "up": 3600 + self._n * 10,
                      "services": ["ok"]})
        self._n += 1

    def risk(self, score: int) -> None:
        score = max(0, min(100, score))
        self.pub("ultron/risk/score", {"v": score}, retain=True)
        self.pub("ultron/risk/band", {"b": band_for(score)}, retain=True)

    def alert(self, aid: str, sev: str, title: str, src: str, body: str) -> None:
        self.pub(f"ultron/alert/{aid}",
                 {"id": aid, "sev": sev, "title": title, "src": src,
                  "body": body, "ts": int(time.time()), "ack": False})

    def stop(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()


def run(feed: Feed) -> None:
    print("\n[1] quiet GREEN")
    for i in range(3):
        feed.health()
        feed.risk(4 + i)
        time.sleep(2)

    print("\n[2] unknown LAN device joins")
    feed.pub("ultron/lan/aabbccddeeff",
             {"mac": "AA:BB:CC:DD:EE:FF", "ip": "192.168.100.57",
              "vendor": "Espressif", "known": False})
    feed.risk(14)
    feed.health()
    time.sleep(3)

    print("\n[3] tripwire pi3a opens")
    feed.pub("ultron/tripwire/pi3a", {"node": "pi3a", "edge": "open"})
    feed.alert("trip-pi3a-1", "yellow", "Case tripwire opened",
               "tripwire/pi3a", "Reed switch edge on Pi3a case lid.")
    feed.risk(38)
    feed.health()
    time.sleep(3)

    print("\n[4] Suricata burst -> RED -> PURPLE")
    for i, sig in enumerate([
        "ET SCAN suspicious inbound",
        "ET MALWARE beaconing",
        "ET EXPLOIT attempt",
        "ET TROJAN C2 checkin",
    ]):
        feed.pub(f"ultron/suricata/{i}",
                 {"signature": sig, "severity": "red", "src": "suricata/eth0"})
        feed.risk(60 + i * 9)
        feed.health()
        time.sleep(2)
    feed.risk(92)  # PURPLE
    feed.alert("crit-1", "purple", "Critical: sustained C2 activity",
               "risk/engine", "Score crossed PURPLE (85). Operator paged.")
    time.sleep(3)

    print("\n[5] decay back to GREEN (-2 / 10s modelled fast)")
    s = 92
    while s > 4:
        s = max(0, s - 8)
        feed.risk(s)
        feed.health()
        time.sleep(1.5)

    print("\n[6] failure beat: Pi3a goes silent (no more health)")
    for _ in range(4):
        feed.health(nodes=("pi4", "pi3b"))  # pi3a omitted -> tile ages to red
        feed.risk(4)
        time.sleep(3)

    print("\n[7] Now KILL mosquitto to watch the header go STALE/OFFLINE:")
    print("      sudo systemctl stop mosquitto   (Ctrl-C here when done)")
    while True:
        feed.health(nodes=("pi4", "pi3b"))
        feed.risk(3)
        time.sleep(5)


def main() -> None:
    ap = argparse.ArgumentParser(description="ULTRON dev-only mock feed")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--user", default=None)
    ap.add_argument("--pass", dest="password", default=None)
    ap.add_argument("--script", default="demo", choices=["demo"],
                    help="scenario to replay (README §7 4-minute demo)")
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

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

The dashboard's ▶ SIM TOUR button AND laptop 3's debug console drive it: the
server relays each request to voidmain/sim/<id> (the server itself never writes
voidmain/risk/#) and this feed — the dev-only bus director — executes it, so the
dashboard, the debug console and the ESP32 OLED panel always show one stream.

Usage:
    pip install paho-mqtt
    python mock_feed.py --host 127.0.0.1 --port 1883 [--user dev --pass dev]
    python mock_feed.py --no-auto      # idle until a trigger arrives
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from pathlib import Path

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("mock_feed needs paho-mqtt:  pip install paho-mqtt", file=sys.stderr)
    raise SystemExit(1)

# One catalogue for every demo event, shared with the dashboard server.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.triggers import (  # noqa: E402  (path bootstrap above)
    ALERT_PRESETS, ALERT_SEVS, DEVICES, EDGE_EVENTS, SEVS, STORY_ALERTS, device_payload,
)

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
        # SIM TOUR relay: voidmain/sim/* comes from the dashboard server; only
        # this dev-only feed writes voidmain/risk/# afterwards.
        self._start = threading.Event()
        self._stop = threading.Event()
        self._paused = False
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.connect(host, port, keepalive=30)
        self.client.loop_start()
        self._n = 0
        self._seq = 0          # unique alert/ids topic suffixes
        self._silent: set[str] = set()   # nodes the debug console took down
        self._alerts: dict[str, dict] = {}  # id -> payload, for ACK updates

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        client.subscribe("voidmain/sim/#", qos=1)   # tour + every debug trigger
        client.subscribe("voidmain/ack/#", qos=1)   # flip alerts on every screen
        print(f"  [sim] listening on voidmain/sim/* ({reason_code})")

    def _on_message(self, client, userdata, message):
        topic = str(message.topic)
        try:
            data = json.loads(message.payload.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        if topic.startswith("voidmain/ack/"):
            self.apply_ack(data)
            return
        if topic == "voidmain/sim/esp32-led" and "ts" in data:
            return
        tid = topic.rsplit("/", 1)[-1]
        print(f"  <- voidmain/sim/{tid}")
        if tid in ("start", "resume"):
            self._paused = False
            self._start.set()
            self._stop.clear()
            print("  [sim] STARTED / RESUMED")
        elif tid in ("stop", "pause"):
            self._paused = not getattr(self, "_paused", False)
            print(f"  [sim] HOLD / PAUSE -> {self._paused}")
        elif tid == "reset":
            print("  [sim] RESET to baseline")
            self._paused = False
            self._stop.set()
            self._start.clear()
            self.seed_devices()
            self.health()
            self.risk(6)
            for aid in list(self._alerts.keys()):
                self.apply_ack({"id": aid})
        elif tid == "abort":
            self._stop.set()
            self._start.clear()
            print("  [sim] ABORTED")
        else:
            self.dispatch(tid, data)

    # ---- FPGA / tinysim LEDs (green/yellow/red/purple) ----
    def led_state(self, sev: str) -> None:
        """Mirror one band colour to any FPGA/tinysim subscriber on the bus.

        Publishes a voidmain/sim/esp32-led event carrying the requested colour so
        the ESP32 risk mini (and any FPGA/tinysim subscriber on the LAN) can drive
        the LED green / yellow / red / purple. The ESP32 panel subscribed to
        voidmain/sim/esp32-led in config.h and drives the NeoPixel from doc["led"].
        """
        self.pub("voidmain/sim/esp32-led", {"led": sev, "ts": int(time.time())})
        print(f"  [tinysim] led -> {sev}")

    def led_cycle(self) -> None:
        """Walk the ESP32 LED through green -> yellow -> red -> purple."""
        for sev in ("green", "yellow", "red", "purple"):
            self.led_state(sev)
            if self.pause(1.2):
                return

    def apply_ack(self, data: dict) -> None:
        """Operator ACK -> republish the alert with ack:true so every open
        dashboard flips it (the store ignores plain duplicate ids, so the ack
        rides on the same alert id)."""
        aid = str(data.get("id", ""))
        stored = self._alerts.get(aid)
        if not stored:
            print(f"  [ack] {aid} not published by this feed (ignored)")
            return
        stored = dict(stored, ack=True, ack_ts=int(time.time()))
        self._alerts[aid] = stored
        self.pub(f"voidmain/alert/{aid}", stored)
        print(f"  [ack] {aid} acknowledged -> all screens")

    # ---- debug console triggers ----
    def dispatch(self, tid: str, data: dict) -> None:
        """Execute one trigger from laptop 3's debug console on the real bus."""
        v, s = data.get("v"), data.get("s")
        ts = int(time.time())
        self._seq += 1

        # preset sequences: one press, whole colour story.
        if tid == "preset/green-warm":
            print("  [preset] green-warm: score 10, devices GREEN, nodes up")
            self.risk(10)
            self.seed_devices()
            self.health()
            return
        if tid == "preset/green-idle":
            print("  [preset] green-idle: score 3, heartbeat only")
            self.risk(3)
            self.health()
            return
        if tid == "preset/yellow-motion":
            print("  [preset] yellow-motion: unusual activity")
            self.device("perimeter", "Perimeter Sensor", "perimeter", "Yard", "yellow", "Motion after hours")
            self.device("air-purifier", "Air Purifier", "purifier", "Living Room", "yellow", "Filter low")
            self.device("smoke-detector", "Smoke Detector", "smoke", "Kitchen", "yellow", "Haze detected")
            self.alert("preset-yellow-1", "yellow", "Unusual activity detected",
                       "iot/perimeter-yard", "Perimeter sensor triggered at 02:14 — no one home.")
            self.ramp_risk(45, steps=5, step_time=0.2)
            return
        if tid == "preset/red-intrusion":
            print("  [preset] red-intrusion: door + camera + campfire + smoke + perimeter")
            self.device("door-front", "Front Door", "lock", "Entrance", "red", "Opened unexpectedly", locked=False)
            self.device("camera-front", "Front Camera", "camera", "Entrance", "red", "Person detected", on=True)
            self.device("campfire", "Campfire", "extinguish", "Backyard", "red", "Smoldering")
            self.device("perimeter", "Perimeter Sensor", "perimeter", "Yard", "red", "Perimeter breached")
            self.device("smoke-detector", "Smoke Detector", "smoke", "Kitchen", "red", "Smoke alarm sounding")
            self.alert("preset-red-1", "red", "Intrusion alert — door + camera + perimeter + smoke",
                       "iot/door-front", "Front door opened unexpectedly, camera detected a person, perimeter breached, smoke alert.")
            self.ramp_risk(75, steps=6, step_time=0.2)
            return
        if tid == "preset/purple-automation":
            print("  [preset] purple-automation: home secured")
            self.device("door-front", "Front Door", "lock", "Entrance", "purple", "Auto-locked",
                        locked=True, automation="Door locked remotely")
            self.device("camera-front", "Front Camera", "camera", "Entrance", "purple", "High-res recording",
                        on=True, automation="Camera switched to high-res")
            self.device("air-purifier", "Air Purifier", "purifier", "Living Room", "purple", "Boosted",
                        on=True, automation="Air purifier boosted")
            self.device("campfire", "Campfire", "extinguish", "Backyard", "purple", "Extinguished",
                        burning=False, automation="Campfire extinguished by automation")
            self.device("perimeter", "Perimeter Sensor", "perimeter", "Yard", "purple", "Perimeter secured",
                        automation="Perimeter integrity restored")
            self.device("smoke-detector", "Smoke Detector", "smoke", "Kitchen", "purple", "Suppression active",
                        automation="Fire suppression deployed")
            self.alert("preset-purple-1", "purple", "Automation executed — home secured",
                       "iot/auto", "Door locked, camera high-res, air purifier boosted, campfire extinguished, suppression deployed.")
            self.ramp_risk(92, steps=4, step_time=0.2)
            return
        if tid == "preset/full-tour":
            print("  [preset] full-tour: GREEN -> YELLOW -> RED -> PURPLE -> GREEN")
            self.seed_devices()
            self.health()
            self.risk(8)
            if self.pause(1.5):
                return
            self.iot_scenario()
            return
        if tid == "preset/ack-story":
            print("  [preset] ack-story: ACK last alert")
            if self._alerts:
                aid = next(iter(self._alerts))
                self.apply_ack({"id": aid})
            return
        if tid == "preset/failure-node-down":
            print("  [preset] failure-node-down: pi3a silent")
            self._silent.add("pi3a")
            self.health()
            return
        if tid == "preset/failure-node-up":
            print("  [preset] failure-node-up: pi3a recovers")
            self._silent.discard("pi3a")
            self.health()
            return
        if tid == "preset/edge-ids":
            print("  [preset] edge-ids: unknown LAN + rogue AP + suricata")
            self.pub("voidmain/lan/de:adbe:ef1234", EDGE_EVENTS["lan-unknown"])
            self.pub("voidmain/wifi/020000aabbcc", EDGE_EVENTS["wifi-rogue"])
            self.pub("voidmain/suricata/2034567", EDGE_EVENTS["suricata"])
            self.led_state("yellow")
            return
        if tid == "preset/esp32-led-cycle":
            print("  [preset] esp32-led-cycle: green/yellow/red/purple")
            self.led_cycle()
            return

        if tid == "score":
            score = max(0, min(100, int(v)))
            print(f"  [trigger] score -> {score} ({band_for(score)})")
            self.risk(score)
            self.led_state(band_for(score))
        elif tid == "alert":
            sev = str(v)
            preset = ALERT_PRESETS[sev]
            print(f"  [trigger] alert sev={sev}")
            self.alert(f"dbg-{sev}-{self._seq}", sev,
                       preset["title"], preset["src"], preset["body"])
            self.led_state(sev)
        elif tid in STORY_ALERTS:
            st = STORY_ALERTS[tid]
            print(f"  [trigger] {tid}")
            if st["sev"] == "red" and tid == "alert-intrusion":
                # red intrusion: door + camera + campfire
                self.device("door-front", "Front Door", "lock", "Entrance", "red", "Opened unexpectedly", locked=False)
                self.device("camera-front", "Front Camera", "camera", "Entrance", "red", "Person detected", on=True)
                self.device("campfire", "Campfire", "extinguish", "Backyard", "red", "Smoldering")
            self.alert(f"{tid}-{self._seq}", st["sev"],
                       st["title"], st["src"], st["body"])
            self.led_state(st["sev"])
        elif tid == "device":
            print(f"  [trigger] device {v} -> {s}")
            self.pub(f"voidmain/device/{v}", device_payload(str(v), str(s), ts))
            sev = str(s)
            if sev in SEVS and sev != "green":
                self.led_state(sev)
        elif tid == "health":
            node, want = str(v), str(s)
            if want == "down":
                self._silent.add(node)
                print(f"  [trigger] {node} silenced (tile ages to red in ~30s)")
            else:
                self._silent.discard(node)
                self.pub(f"voidmain/health/{node}",
                         {"node": node, "up": 3600 + self._n * 10, "services": ["ok"]})
                print(f"  [trigger] {node} heartbeat restored")
        elif tid in ("sim/esp32-led", "esp32-led"):
            sev = str(data.get("led", s or "green"))
            print(f"  [trigger] sim/esp32-led -> {sev}")
            self.led_state(sev)
        elif tid == "sim/esp32-led-cycle":
            print(f"  [trigger] sim/esp32-led-cycle")
            self.led_cycle()
        elif tid in EDGE_EVENTS:
            payload = EDGE_EVENTS[tid]
            leaf = str(payload.get("mac", payload.get("node", tid))).replace(":", "")
            topic = f"voidmain/{tid.split('-', 1)[0]}/{leaf}"
            print(f"  [trigger] {tid} -> {topic}")
            self.pub(topic, payload)
            sev = str(payload.get("sev", "yellow"))
            self.led_state(sev)
        else:
            print(f"  [trigger] no handler for {tid} (ignored)")

    # ---- tour control (stop holds/pauses, start resumes) ----
    def pause(self, seconds: float) -> bool:
        """Sleep; respects pause/hold while keeping heartbeats and risk active."""
        end = time.time() + seconds
        while time.time() < end:
            if self._stop.is_set():
                return True
            while getattr(self, "_paused", False):
                time.sleep(1.0)
                self.health()
                self.risk(getattr(self, "_score", 10))
                if self._stop.is_set():
                    return True
            time.sleep(min(0.2, max(0.02, end - time.time())))
        return False

    def aborted(self) -> bool:
        return self._stop.is_set()

    def take_start(self) -> bool:
        """Consume a SIM TOUR trigger (a stale stop goes with it)."""
        if not self._start.is_set():
            return False
        self._start.clear()
        self._stop.clear()
        return True

    def wait_start(self, seconds: float) -> bool:
        return self._start.wait(timeout=seconds)

    def trigger_start(self) -> None:
        """Boot-time auto tour (same behaviour as before the button existed)."""
        self._start.set()

    def pub(self, topic: str, payload: dict | str | int, retain: bool = False) -> None:
        data = payload if isinstance(payload, str) else json.dumps(payload)
        self.client.publish(topic, data, qos=1, retain=retain)
        print(f"  -> {topic:26s} {data}")

    def health(self, nodes: tuple[str, ...] = ("pi4", "pi3a", "pi3b")) -> None:
        for node in nodes:
            if node in self._silent:   # debug console took this node down
                continue
            self.pub(f"voidmain/health/{node}",
                     {"node": node, "up": 3600 + self._n * 10,
                      "services": ["ok"]})
        self._n += 1

    def risk(self, score: int) -> None:
        score = max(0, min(100, score))
        self._score = score
        band = band_for(score)
        self.pub("voidmain/risk/score", {"v": score}, retain=True)
        self.pub("voidmain/risk/band", {"b": band}, retain=True)
        self.pub("voidmain/sim/esp32-led", {"led": band.lower(), "ts": int(time.time())}, retain=True)

    def ramp_risk(self, target: int, steps: int = 8, step_time: float = 0.3) -> bool:
        cur = getattr(self, "_score", 10)
        target = max(0, min(100, target))
        if cur == target:
            return False
        diff = target - cur
        for i in range(1, steps + 1):
            if self.aborted():
                return True
            while getattr(self, "_paused", False):
                time.sleep(1.0)
                self.health()
                self.risk(getattr(self, "_score", cur))
                if self.aborted():
                    return True
            val = int(cur + (diff * i) / steps)
            self.risk(val)
            if i < steps and self.pause(step_time):
                return True
        return False

    def alert(self, aid: str, sev: str, title: str, src: str, body: str) -> None:
        payload = {"id": aid, "sev": sev, "title": title, "src": src,
                   "body": body, "ts": int(time.time()), "ack": False}
        if len(self._alerts) > 200:
            self._alerts.pop(next(iter(self._alerts)))
        self._alerts[aid] = payload
        self.pub(f"voidmain/alert/{aid}", payload)

    def device(self, did: str, name: str, kind: str, room: str, sev: str, state: str, **kw) -> None:
        payload = {"id": did, "name": name, "kind": kind, "room": room,
                   "sev": sev, "state": state, "ts": int(time.time()), **kw}
        self.pub(f"voidmain/device/{did}", payload)

    def seed_devices(self) -> None:
        print("  seeding IoT devices (all GREEN)")
        ts = int(time.time())
        for dev in DEVICES:          # catalogue shared with the debug console
            self.pub(f"voidmain/device/{dev['id']}", device_payload(dev["id"], "green", ts))

    def iot_scenario(self) -> None:
        # ---- Phase 2: YELLOW Anomaly Stage (12.0s) ----
        print("  [0:08 - 0:20] IoT YELLOW — unusual activity (12s)")
        self.device("perimeter", "Perimeter Sensor", "perimeter", "Yard", "yellow", "Motion after hours (02:14 AM)")
        if self.pause(2.0):
            return
        self.device("air-purifier", "Air Purifier", "purifier", "Living Room", "yellow", "Particulate spike / Filter warning")
        if self.pause(1.5):
            return
        self.device("smoke-detector", "Smoke Detector", "smoke", "Kitchen", "yellow", "Haze detected in kitchen")
        if self.pause(1.0):
            return
        self.alert("iot-yellow-1", "yellow", "Unusual activity — perimeter motion + environmental drift",
                   "iot/perimeter-yard", "Perimeter sensor triggered at 02:14 — no one home. Air purifier and smoke detector report early haze.")
        if self.ramp_risk(45, steps=10, step_time=0.35):
            return
        if self.pause(4.0):
            return

        # ---- Phase 3: RED Intrusion Peak Stage (16.0s) ----
        print("  [0:20 - 0:36] IoT RED — intrusion peak alert (16s)")
        self.device("perimeter", "Perimeter Sensor", "perimeter", "Yard", "red", "Perimeter breached")
        if self.pause(1.5):
            return
        self.device("door-front", "Front Door", "lock", "Entrance", "red", "Opened unexpectedly", locked=False)
        if self.pause(1.0):
            return
        self.device("camera-front", "Front Camera", "camera", "Entrance", "red", "Person detected", on=True)
        if self.pause(1.0):
            return
        self.device("campfire", "Campfire", "extinguish", "Backyard", "red", "Smoldering unattended", burning=True)
        if self.pause(1.0):
            return
        self.device("smoke-detector", "Smoke Detector", "smoke", "Kitchen", "red", "Smoke alarm sounding")
        if self.pause(1.0):
            return
        self.alert("iot-red-1", "red", "CRITICAL Intrusion — perimeter breached, front door forced, person detected",
                   "iot/door-front", "Front door opened unexpectedly, camera detected unauthorized person, perimeter breached, kitchen smoke alarm sounding. Dispatched alert to Elena Vance.")
        if self.ramp_risk(78, steps=11, step_time=0.4):
            return
        if self.pause(6.1):
            return

        # ---- Phase 4: PURPLE Autonomous Lockdown Stage (14.0s) ----
        print("  [0:36 - 0:50] IoT PURPLE — autonomous lockdown (14s)")
        self.device("door-front", "Front Door", "lock", "Entrance", "purple", "Auto-locked",
                    locked=True, automation="Autonomous remote deadbolt engaged")
        if self.pause(1.0):
            return
        self.device("camera-front", "Front Camera", "camera", "Entrance", "purple", "High-res recording",
                    on=True, automation="Camera switched to 4K evidence capture")
        if self.pause(1.0):
            return
        self.device("air-purifier", "Air Purifier", "purifier", "Living Room", "purple", "Boosted",
                    on=True, automation="Air scrubber overdrive engaged")
        if self.pause(1.0):
            return
        self.device("campfire", "Campfire", "extinguish", "Backyard", "purple", "Extinguished",
                    burning=False, automation="Sprinkler automation extinguished fire")
        if self.pause(1.0):
            return
        self.device("perimeter", "Perimeter Sensor", "perimeter", "Yard", "purple", "Perimeter secured",
                    automation="Zone isolation active")
        self.device("smoke-detector", "Smoke Detector", "smoke", "Kitchen", "purple", "Suppression active",
                    automation="Halon / mist suppression active")
        self.alert("iot-purple-1", "purple", "Autonomous policy executed — home secured in 180ms",
                   "iot/auto", "Door locked remotely, 4K camera engaged, air purifier boosted, fire suppressed, perimeter isolated. False alarm probability: 0.02%.")
        if self.ramp_risk(92, steps=8, step_time=0.35):
            return
        if self.pause(6.2):
            return

        # ---- Phase 5: Smooth Decay & Recovery (10.0s) ----
        print("  [0:50 - 1:00] IoT GREEN — smooth recovery (10s)")
        if self.ramp_risk(6, steps=14, step_time=0.35):
            return
        self.device("door-front", "Front Door", "lock", "Entrance", "green", "Locked", locked=True)
        self.device("camera-front", "Front Camera", "camera", "Entrance", "green", "Armed recording", on=True)
        self.device("air-purifier", "Air Purifier", "purifier", "Living Room", "green", "On auto", on=True)
        self.device("campfire", "Campfire", "extinguish", "Backyard", "green", "Burning", burning=True)
        self.device("perimeter", "Perimeter Sensor", "perimeter", "Yard", "green", "Clear")
        self.device("smoke-detector", "Smoke Detector", "smoke", "Kitchen", "green", "Clear")
        for aid in list(self._alerts.keys()):
            self.apply_ack({"id": aid})
        if self.pause(5.1):
            return

    def stop(self) -> None:
        self.client.loop_stop()
        self.client.disconnect()


def run(feed: Feed) -> None:
    """One full 60-second GREEN -> YELLOW -> RED -> PURPLE -> GREEN demo arc."""
    print("\n[0:00 - 0:08] Quiet GREEN baseline — seed all 6 IoT devices (8s)")
    feed.seed_devices()
    feed.health()
    feed.risk(6)
    if feed.pause(8.0):
        return

    feed.iot_scenario()
    if feed.aborted():
        return

    feed.health()
    feed.risk(6)


def baseline(feed: Feed) -> None:
    """Idle heartbeat: every simulated node healthy, risk parked at GREEN."""
    feed.health()
    feed.risk(6)


def run_forever(feed: Feed, auto: bool) -> None:
    """Continuous demo tour loop with pause/hold and reset capability."""
    print("  [director] starting continuous demo simulation loop...")
    if auto:
        feed.trigger_start()
    else:
        print("  [director] idling at GREEN baseline until voidmain/sim/start...")
        feed.seed_devices()
        feed.health()
        feed.risk(6)

    cycle_count = 0
    while True:
        # If not started, idle at baseline
        while not feed.take_start():
            time.sleep(1.0)
            feed.health()
            feed.risk(getattr(feed, "_score", 6))
            if feed.aborted():
                feed._stop.clear()

        cycle_count += 1
        print(f"\n  [director] === Starting 60s scenario cycle #{cycle_count} ===")
        was_aborted = False
        try:
            run(feed)
            was_aborted = feed.aborted()
        except Exception as e:
            print(f"  [error] in run: {e}")
        finally:
            feed._stop.clear()

        if was_aborted:
            print("  [director] tour was reset/aborted — resting at GREEN baseline")
            feed.seed_devices()
            feed.health()
            feed.risk(6)
            continue

        print(f"  [director] === Completed cycle #{cycle_count} — looping continuously ===")
        # Brief pause between loop iterations at GREEN baseline (respects pause/hold)
        if feed.pause(2.0):
            feed._stop.clear()
            continue
        feed.trigger_start()


def main() -> None:
    ap = argparse.ArgumentParser(description="VoidMain dev-only mock feed")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--user", default=None)
    ap.add_argument("--pass", dest="password", default=None)
    ap.add_argument("--script", default="demo", choices=["demo"],
                    help="scenario to replay (IoT smart-home demo)")
    ap.add_argument("--no-auto", action="store_true",
                    help="idle at GREEN until the dashboard sends voidmain/sim/start")
    args = ap.parse_args()

    print(BANNER)
    feed = Feed(args.host, args.port, args.user, args.password)
    try:
        run_forever(feed, auto=not args.no_auto)
    except KeyboardInterrupt:
        print("\nstopping mock feed.")
    finally:
        feed.stop()


if __name__ == "__main__":
    main()

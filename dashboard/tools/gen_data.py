#!/usr/bin/env python3
"""VoidMain evidence data generator — populate evidence.db with rich show data.

Generates 30 days of score history + diverse alerts across all severities,
device states, LAN events, tripwires, and edge/IDS events so the dashboard
looks fully populated on first launch.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import evidence
from server.triggers import ALERT_PRESETS, DEVICES, EDGE_EVENTS, device_payload

BANDS = ["GREEN", "YELLOW", "RED", "PURPLE"]
SEVS = ["green", "yellow", "red", "purple"]
ALERT_SEVS = ["info", "yellow", "red", "purple"]


def random_score_trend(days: int) -> list[tuple[int, int]]:
    """Generate realistic-looking score history: mostly GREEN with occasional spikes."""
    points: list[tuple[int, int]] = []
    now = int(time.time())
    start = now - days * 86400
    t = start
    score = random.randint(2, 8)
    while t <= now:
        if random.random() < 0.002:
            spike = random.choice([45, 55, 70, 88, 95])
            score = min(100, max(0, score + random.choice([-15, -10, spike - score])))
        else:
            score += random.choice([-2, -1, 0, 0, 0, 1, 2])
            score = max(0, min(100, score))
        points.append((t, score))
        t += random.randint(60, 300)
    return points


def generate_alerts(days: int) -> list[dict]:
    alarms: list[dict] = []
    now = int(time.time())
    start = now - days * 86400
    t = start
    n = 0
    while t <= now:
        r = random.random()
        if r < 0.5:
            sev = "info"
            title = random.choice([
                "Routine check — all sensors nominal",
                "Scheduled sweep: no anomalies",
                "System health check passed",
                "Background calibration complete",
            ])
            src = random.choice(["risk/engine", "iot/auto", "health/pi4"])
        elif r < 0.75:
            sev = "yellow"
            title = random.choice([
                "Unusual activity detected",
                "Water leak under sink",
                "Node pi3a heartbeat lost",
                "Motion after hours — yard",
                "Temperature rising — hallway",
                "Moisture detected — utility room",
            ])
            src = random.choice(["iot/motion-yard", "iot/leak-utility", "health/pi3a", "iot/thermostat"])
        elif r < 0.93:
            sev = "red"
            title = random.choice([
                "Intrusion alert — door + camera",
                "Smoke threshold exceeded — kitchen",
                "Front door opened unexpectedly",
                "Perimeter breach detected",
                "Camera person detection — entrance",
            ])
            src = random.choice(["iot/door-front", "iot/camera-front", "iot/door-front"])
        else:
            sev = "purple"
            title = random.choice([
                "Automation executed — home secured",
                "All doors locked — perimeter secure",
                "Cameras switched to high-res recording",
                "Air purifier boosted — air quality restored",
                "Campfire extinguished by automation",
            ])
            src = "iot/auto"
        body = f"Automated alert from {src}. Timestamp: {datetime.fromtimestamp(t, tz=timezone.utc).isoformat()}."
        n += 1
        aid = f"gen-{sev}-{n:04d}-{t}"
        ack = random.random() < 0.7
        alarms.append({
            "id": aid, "sev": sev, "title": title, "src": src,
            "body": body, "ts": t, "ack": ack,
            "ack_ts": t + random.randint(10, 300) if ack else None,
        })
        t += random.randint(60, 1800)
    alarms.sort(key=lambda a: a["ts"])
    return alarms


def _write_all(db_path, points, alarms):
    import asyncio
    return asyncio.run(_write(db_path, points, alarms))


async def _write(db_path, points, alarms):
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # wipe old data
    if path.exists():
        path.unlink()
    from server.evidence import _SCHEMA
    import aiosqlite
    async with aiosqlite.connect(path) as db:
        await db.executescript(_SCHEMA)
        # score history
        for ts, score in points:
            await db.execute(
                "INSERT INTO scores (ts, score) VALUES (?, ?)", (ts, score))
        # alerts
        for a in alarms:
            await db.execute(
                "INSERT INTO alerts (id, ts, sev, title, src, body, ack, ack_ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (a["id"], a["ts"], a["sev"], a["title"], a["src"], a["body"],
                 1 if a["ack"] else 0, a["ack_ts"]),
            )
        # extra device state events for rich IoT panel
        now = int(time.time())
        for dev in DEVICES:
            for sev in SEVS:
                ts = now - random.randint(3600, 86400 * 3)
                payload = device_payload(dev["id"], sev, ts)
                await db.execute(
                    "INSERT OR IGNORE INTO alerts (id, ts, sev, title, src, body, ack, ack_ts) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
                    (f"dev-{dev['id']}-{sev}-{ts}", ts, sev,
                     f"{dev['name']} — {payload['state']}",
                     f"iot/{dev['id']}",
                     f"Device state: {payload['state']}",
                     ts),
                )
        # LAN events
        for _ in range(40):
            ts = now - random.randint(3600, 86400 * 5)
            ev = random.choice(list(EDGE_EVENTS.values()))
            mac = ev.get("mac", "") or ev.get("node", "")
            leaf = mac.replace(":", "")
            topic = f"voidmain/{('lan' if 'mac' in ev else 'wifi' if 'ssid' in ev else 'suricata')}/{leaf}"
            await db.execute(
                "INSERT OR IGNORE INTO alerts (id, ts, sev, title, src, body, ack, ack_ts) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
                (f"edge-{leaf}-{ts}", ts, ev.get("sev", "info"),
                 ev.get("title", "Event"), "net/ids",
                 str(ev), ts),
            )
        await db.commit()
    print(f"  wrote {len(points)} score points, {len(alarms)} alerts, device + edge events")


def main():
    ap = argparse.ArgumentParser(description="VoidMain evidence data generator")
    ap.add_argument("--db", default=None, help="path to evidence.db")
    ap.add_argument("--days", type=int, default=30)
    args = ap.parse_args()
    if args.db is None:
        args.db = Path(__file__).resolve().parents[1] / "evidence.db"
    print(f"Generating {args.days} days → {args.db}")
    points = random_score_trend(args.days)
    alarms = generate_alerts(args.days)
    print(f"  score points: {len(points)}, alerts: {len(alarms)}")
    _write_all(args.db, points, alarms)
    print("Done.")


if __name__ == "__main__":
    main()

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
    i = 0
    while t <= now:
        r = random.random()
        if r < 0.22:
            sev = "info"
            title = random.choice([
                "Routine check — all sensors nominal",
                "Scheduled sweep: no anomalies",
                "System health check passed",
                "Background calibration complete",
                "Environmental baseline re-established",
                "Node heartbeat gap recovered",
            ])
            src = random.choice(["risk/engine", "iot/auto", "health/pi4", "health/pi3a"])
        elif r < 0.46:
            sev = "yellow"
            title = random.choice([
                "Unusual activity detected",
                "Perimeter sensor triggered after hours",
                "Node pi3a heartbeat lost",
                "Temperature rising — hallway",
                "Moisture detected — utility room",
                "Air purifier filter low",
                "Perimeter zone watch — slow drift",
                "Repeated motion pattern — yard",
            ])
            src = random.choice(["iot/perimeter-yard", "iot/leak-utility", "health/pi3a", "iot/thermostat", "iot/air-purifier"])
        elif r < 0.74:
            sev = "red"
            title = random.choice([
                "Intrusion alert — door + camera + perimeter",
                "Perimeter breach detected",
                "Front door opened unexpectedly",
                "Camera person detection — entrance",
                "Campfire smoldering — unattended",
                "Perimeter tamper alert — backyard",
                "Multi-zone alert — entrance + yard",
            ])
            src = random.choice(["iot/door-front", "iot/camera-front", "iot/perimeter-yard", "iot/campfire"])
        else:
            sev = "purple"
            title = random.choice([
                "Automation executed — home secured",
                "All doors locked — perimeter secure",
                "Air purifier boosted — air quality restored",
                "Campfire extinguished by automation",
                "Perimeter integrity restored",
                "Cameras switched to high-res recording",
                "Door + camera + perimeter response",
                "Full perimeter lockdown completed",
            ])
            src = "iot/auto"
        body = (
            f"Automated alert from {src}. "
            f"Sensor snapshot: score in band {random.choice(['GREEN','YELLOW','RED','PURPLE'])}, "
            f"{random.choice(['perimeter clear','perimeter breached','door locked','door ajar','camera armed','camera person','campfire burning','campfire smoldering','air purifier boosted','air purifier off'])}. "
            f"Timestamp: {datetime.fromtimestamp(t, tz=timezone.utc).isoformat()}."
        )
        n += 1
        aid = f"gen-{sev}-{n:05d}-{t}"
        ack = random.random() < 0.62
        alarms.append({
            "id": aid, "sev": sev, "title": title, "src": src,
            "body": body, "ts": t, "ack": ack,
            "ack_ts": t + random.randint(8, 240) if ack else None,
        })
        t += random.randint(10, 420)
        i += 1
        if i % 5000 == 0:
            t = min(now, t + random.randint(1, 600))
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
        # extra device state events for rich IoT panel (5-device fleet)
        now = int(time.time())
        # device state event pool — one row per device per severity spread across 30 days
        # so every device tile on the dashboard has a visible history.
        fleet = [
            ("campfire", "extinguish", "Backyard", "Burning", "Waning", "Smoldering", "Extinguished"),
            ("air-purifier", "purifier", "Living Room", "On auto", "Filter low", "Off", "Boosted"),
            ("door-front", "lock", "Entrance", "Locked", "Ajar", "Opened unexpectedly", "Auto-locked"),
            ("camera-front", "camera", "Entrance", "Armed recording", "Motion clip saved", "Person detected", "High-res recording"),
            ("perimeter", "perimeter", "Yard", "Clear", "Motion after hours", "Perimeter breached", "Perimeter secured"),
        ]
        for did, kind, room, g_state, y_state, r_state, p_state in fleet:
            for sev, state in (("green", g_state), ("yellow", y_state), ("red", r_state), ("purple", p_state)):
                base = now - 86400 * 30
                for offset in sorted(random.sample(range(0, 86400 * 30, 3600), k=360)):
                    ts = base + offset
                    await db.execute(
                        "INSERT OR IGNORE INTO alerts (id, ts, sev, title, src, body, ack, ack_ts) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
                        (f"dev-{did}-{sev}-{ts}", ts, sev,
                         f"{did} — {state}",
                         f"iot/{did}",
                         f"Device state: {state}",
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

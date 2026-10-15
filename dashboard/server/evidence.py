"""Evidence log writer — scores + alerts, read back by db.py on WS join.

db.py is deliberately read-only (`mode=ro`); this module is the only writer, so
the dashboard can replay 24h of score history and acked alerts to a browser
that joins half-way through a demo. Path comes from config (dev-safe default:
dashboard/evidence.db; the Pi4 sets VOIDMAIN_EVIDENCE_DB=/mnt/pendrive/…).
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

try:
    import aiosqlite
except ImportError:  # pragma: no cover
    aiosqlite = None  # type: ignore[assignment]

LOG = logging.getLogger("voidmain.evidence")

KEEP_SECONDS = 24 * 60 * 60

_SCHEMA = """
CREATE TABLE IF NOT EXISTS scores (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    ts    INTEGER NOT NULL,
    score INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scores_ts ON scores(ts);
CREATE TABLE IF NOT EXISTS alerts (
    id     TEXT PRIMARY KEY,
    ts     INTEGER NOT NULL,
    sev    TEXT,
    title  TEXT,
    src    TEXT,
    body   TEXT,
    ack    INTEGER NOT NULL DEFAULT 0,
    ack_ts INTEGER
);
"""


async def _write(path: Path, stmt: str, args: tuple) -> None:
    """One short transaction per event — demo rates are a few per second."""
    if aiosqlite is None or path is None:
        return
    try:
        async with aiosqlite.connect(path) as db:
            await db.executescript(_SCHEMA)
            await db.execute(stmt, args)
            await db.execute("DELETE FROM scores WHERE ts < ?",
                             (int(time.time()) - KEEP_SECONDS,))
            await db.commit()
    except Exception as exc:  # noqa: BLE001 — evidence must never break the feed
        LOG.warning("evidence write failed: %s", exc)


async def record(path: Path, mapped: dict[str, Any] | None) -> None:
    """Persist one bridge-mapped envelope: score -> scores, alert -> alerts.

    Alert rows are keyed by id, so the director's ack republish (ack:true)
    updates the stored row and a later join sees the alert as acknowledged.
    """
    if not mapped:
        return
    t = mapped.get("t")
    d = mapped.get("d") or {}
    if not isinstance(d, dict):
        return
    if t == "score":
        try:
            score = int(round(float(d.get("v"))))
        except (TypeError, ValueError):
            return
        await _write(path, "INSERT OR REPLACE INTO scores (ts, score) VALUES (?, ?)",
                     (int(time.time()), max(0, min(100, score))))
    elif t == "alert" and d.get("id"):
        await _write(
            path,
            "INSERT OR REPLACE INTO alerts "
            "(id, ts, sev, title, src, body, ack, ack_ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                str(d["id"])[:128],
                int(d.get("ts") or time.time()),
                str(d.get("sev") or "info"),
                str(d.get("title") or "")[:200],
                str(d.get("src") or "")[:200],
                str(d.get("body") or "")[:2000],
                1 if d.get("ack") else 0,
                int(d["ack_ts"]) if d.get("ack_ts") else None,
            ),
        )

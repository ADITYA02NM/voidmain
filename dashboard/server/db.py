"""Read-only access to the evidence SQLite (Pi4 USB3 pendrive).

The dashboard NEVER writes here. It reads:
  * scores  — 24h history for the chart on WS join
  * alerts  — recent alerts + their stored ack state (so ACK survives refresh)
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

LOG = logging.getLogger("ultron.db")

HISTORY_SECONDS = 24 * 60 * 60
RECENT_ALERT_LIMIT = 200


def _ro_uri(path: Path) -> str:
    return f"file:{path}?mode=ro"


async def db_readable(path: Path) -> bool:
    if aiosqlite is None or not path.exists():
        return False
    try:
        async with aiosqlite.connect(_ro_uri(path), uri=True) as db:
            await db.execute("SELECT 1")
        return True
    except Exception:  # noqa: BLE001
        return False


async def read_history(path: Path) -> list[list[int]]:
    if aiosqlite is None or not path.exists():
        return []
    cutoff = int(time.time()) - HISTORY_SECONDS
    try:
        async with aiosqlite.connect(_ro_uri(path), uri=True) as db:
            rows = await db.execute_fetchall(
                "SELECT ts, score FROM scores WHERE ts >= ? ORDER BY ts ASC", (cutoff,)
            )
        return [[int(ts), int(score)] for ts, score in rows]
    except Exception as exc:  # noqa: BLE001
        LOG.warning("history read failed: %s", exc)
        return []


async def read_recent_alerts(path: Path) -> list[dict[str, Any]]:
    if aiosqlite is None or not path.exists():
        return []
    cutoff = int(time.time()) - HISTORY_SECONDS
    try:
        async with aiosqlite.connect(_ro_uri(path), uri=True) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                "SELECT id, ts, sev, title, src, body, ack, ack_ts FROM alerts "
                "WHERE ts >= ? ORDER BY ts DESC LIMIT ?",
                (cutoff, RECENT_ALERT_LIMIT),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r["id"]), "ts": int(r["ts"]), "sev": r["sev"],
                "title": r["title"], "src": r["src"], "body": r["body"],
                "ack": bool(r["ack"]), "ack_ts": r["ack_ts"],
            }
            for r in rows
        ]
    except Exception as exc:  # noqa: BLE001
        LOG.warning("recent-alert read failed: %s", exc)
        return []

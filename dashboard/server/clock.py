"""Transport-level clock-sync control frames on /ws.

These are NOT envelope data types and never touch MQTT. The browser measures
its offset to the server clock so bus->screen latency can be computed honestly.

    client -> {"ctl":"ping","c":<client_ms>}
    server -> {"ctl":"pong","c":<client_ms>,"s":<server_ms>}

The browser then estimates: offset ≈ s - (c + rtt/2), rtt = now - c.
"""

from __future__ import annotations

import time
from typing import Any


def server_ms() -> int:
    return int(time.time() * 1000)


def is_ctl(msg: dict[str, Any]) -> bool:
    return isinstance(msg, dict) and "ctl" in msg


def make_pong(msg: dict[str, Any]) -> dict[str, Any] | None:
    if msg.get("ctl") != "ping":
        return None
    return {"ctl": "pong", "c": msg.get("c"), "s": server_ms()}

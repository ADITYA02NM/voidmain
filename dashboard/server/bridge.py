"""MQTT <-> WebSocket bridge: allowlist, envelope normalisation, fan-out.

Contract (dashboard.md §5): envelope {t, ts, d}, t in
alert|score|band|health|lan|tripwire|history|toast|event|device. ts is stamped at
MQTT-receive time. suricata/wifi are surfaced as t:"event" with structured
fields (topic, node, kind, sev, summary + whitelisted src_ip/dest_ip/mac/sig_id).
Alerts come only from voidmain/alert/# (owned by Pi3b).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

from aiohttp import web

from . import evidence
from .triggers import PRESET_IDS, TRIGGER_IDS
VALID_SIM_IDS: frozenset[str] = TRIGGER_IDS | PRESET_IDS

try:
    import aiomqtt
except ImportError:  # pragma: no cover
    aiomqtt = None  # type: ignore[assignment]

LOG = logging.getLogger("voidmain.bridge")

# The subscribe allowlist — exactly dashboard.md §5. Nothing outside this.
SUB_TOPICS: tuple[str, ...] = (
    "voidmain/health/#",
    "voidmain/alert/#",
    "voidmain/risk/score",
    "voidmain/risk/band",
    "voidmain/lan/#",
    "voidmain/tripwire/#",
    "voidmain/suricata/#",
    "voidmain/wifi/#",
    "voidmain/device/#",
)

VALID_T = {"alert", "score", "band", "health", "lan", "tripwire", "history", "toast", "event", "device"}


def _loads(payload: bytes) -> Any:
    try:
        return json.loads(payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return payload.decode("utf-8", "replace").strip()


def _leaf(topic: str) -> str:
    return topic.rsplit("/", 1)[-1]


def map_message(topic: str, payload: bytes) -> dict[str, Any] | None:
    """MQTT (topic, payload) -> {t, d} or None if not mappable."""
    data = _loads(payload)

    if topic == "voidmain/risk/score":
        v = data.get("v", data.get("score")) if isinstance(data, dict) else data
        try:
            return {"t": "score", "d": {"v": int(round(float(v)))}}
        except (TypeError, ValueError):
            return None

    if topic == "voidmain/risk/band":
        b = data.get("b", data.get("band")) if isinstance(data, dict) else data
        b = str(b).upper()
        return {"t": "band", "d": {"b": b}} if b in ("GREEN", "YELLOW", "RED", "PURPLE") else None

    if topic.startswith("voidmain/alert/"):
        d = data if isinstance(data, dict) else {"body": str(data)}
        d.setdefault("id", _leaf(topic))
        d.setdefault("sev", "info")
        d.setdefault("ack", False)
        return {"t": "alert", "d": d}

    if topic.startswith("voidmain/health/"):
        d = data if isinstance(data, dict) else {}
        d.setdefault("node", _leaf(topic))
        return {"t": "health", "d": d}

    if topic.startswith("voidmain/lan/"):
        return {"t": "lan", "d": data if isinstance(data, dict) else {}}

    if topic.startswith("voidmain/tripwire/"):
        d = data if isinstance(data, dict) else {}
        d.setdefault("node", _leaf(topic))
        d.setdefault("edge", "open")
        return {"t": "tripwire", "d": d}

    if topic.startswith("voidmain/suricata/"):
        d = data if isinstance(data, dict) else {}
        sev = d.get("severity", d.get("sev", "info"))
        summary = d.get("signature", d.get("title", "Suricata IDS alert"))
        ev: dict[str, Any] = {
            "topic": topic, "node": "pi3a", "kind": "suricata",
            "sev": str(sev), "summary": str(summary),
        }
        for k in ("src_ip", "dest_ip", "mac", "sig_id"):
            if k in d:
                ev[k] = d[k]
        return {"t": "event", "d": ev}

    if topic.startswith("voidmain/wifi/"):
        d = data if isinstance(data, dict) else {}
        sev = d.get("severity", d.get("sev", "info"))
        summary = d.get("title", d.get("detail", "WiFi anomaly"))
        ev = {
            "topic": topic, "node": "pi3a", "kind": "wifi",
            "sev": str(sev), "summary": str(summary),
        }
        for k in ("src_ip", "dest_ip", "mac"):
            if k in d:
                ev[k] = d[k]
        return {"t": "event", "d": ev}

    if topic.startswith("voidmain/device/"):
        d = data if isinstance(data, dict) else {}
        d.setdefault("id", _leaf(topic))
        d.setdefault("sev", "green")
        d.setdefault("state", "—")
        return {"t": "device", "d": d}

    # 5-device fleet handled above; firmware mirrors the same device/# topic set
    # (campfire, air-purifier, door-front, camera-front, perimeter) plus a direct
    # LED mirror on voidmain/sim/esp32-led so laptop 3's LED-cycle button drives
    # the NeoPixel in step with the dashboard + debug console.
    if topic.startswith("voidmain/sim/esp32-led"):
        d = data if isinstance(data, dict) else {}
        d.setdefault("led", _leaf(topic))
        return {"t": "device", "d": {"id": "esp32-led", "name": "ESP32 LED", "kind": "led",
                                     "room": "Panel", "sev": str(d.get("led", "green")),
                                     "state": f"LED {d.get('led', 'green')}"}}

    return None


def envelope(t: str, d: Any, ts: float | None = None) -> dict[str, Any]:
    # ts is seconds since epoch with ms precision (for honest bus->screen latency).
    return {"t": t, "ts": ts if ts is not None else round(time.time(), 3), "d": d}


class Hub:
    """Fan-out of envelopes to all connected browser sockets."""

    def __init__(self) -> None:
        self._clients: set[web.WebSocketResponse] = set()

    def add(self, ws: web.WebSocketResponse) -> None:
        self._clients.add(ws)

    def remove(self, ws: web.WebSocketResponse) -> None:
        self._clients.discard(ws)

    @property
    def count(self) -> int:
        return len(self._clients)

    async def broadcast(self, env: dict[str, Any]) -> None:
        if not self._clients:
            return
        text = json.dumps(env, separators=(",", ":"))
        dead = []
        for ws in self._clients:
            try:
                await ws.send_str(text)
            except (ConnectionError, RuntimeError):
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)


class Bridge:
    """Long-lived, self-reconnecting MQTT client feeding the Hub."""

    def __init__(self, cfg, hub: Hub) -> None:
        self.cfg = cfg
        self.hub = hub
        self.connected = False
        self._client = None
        self._stop = asyncio.Event()

    async def publish_ack(self, alert_id: str) -> bool:
        """Publish an operator ACK to voidmain/ack/{id}. Never touches risk/#."""
        if self._client is None or not self.connected:
            return False
        safe = re.sub(r"[^A-Za-z0-9_.:-]", "", alert_id)[:128]
        if not safe:
            return False
        payload = json.dumps({"id": safe, "ts": int(time.time()), "op": "dashboard"})
        try:
            await self._client.publish(f"voidmain/ack/{safe}", payload.encode("utf-8"), qos=1)
            return True
        except Exception as exc:  # noqa: BLE001
            LOG.warning("ack publish failed for %s: %s", safe, exc)
            return False

    def stop(self) -> None:
        self._stop.set()

    async def publish_sim(self, action: str, data: dict | None = None) -> bool:
        """Relay a demo trigger (SIM TOUR button or debug console) to the DEV
        director on voidmain/sim/<id>.

        Writes only voidmain/sim/* — the server never touches voidmain/risk/#.
        tools/mock_feed.py subscribes here and publishes the event stream, so
        dashboard, debug console and ESP32 OLED change together on the bus.
        """
        if action not in VALID_SIM_IDS:
            return False
        if self._client is None or not self.connected:
            return False
        body = dict(data) if data else {}
        body.setdefault("ts", int(time.time()))
        try:
            await self._client.publish(f"voidmain/sim/{action}",
                                       json.dumps(body).encode("utf-8"), qos=1)
            return True
        except Exception as exc:  # noqa: BLE001
            LOG.warning("sim publish failed for %s: %s", action, exc)
            return False

    async def run(self) -> None:
        if aiomqtt is None:
            LOG.error("aiomqtt not installed; live bridge disabled")
            return
        backoff = 1
        while not self._stop.is_set():
            try:
                kwargs: dict[str, Any] = dict(hostname=self.cfg.mqtt_host, port=self.cfg.mqtt_port)
                if self.cfg.mqtt_user:
                    kwargs.update(username=self.cfg.mqtt_user, password=self.cfg.mqtt_pass)
                async with aiomqtt.Client(**kwargs) as client:
                    self._client = client
                    self.connected = True
                    backoff = 1
                    LOG.info("MQTT connected %s:%s", self.cfg.mqtt_host, self.cfg.mqtt_port)
                    await self.hub.broadcast(envelope("toast", {"msg": "MQTT LIVE", "sev": "green"}))
                    for topic in SUB_TOPICS:
                        await client.subscribe(topic)
                    async for message in client.messages:
                        ts = round(time.time(), 3)  # MQTT-receive time, ms precision
                        mapped = map_message(str(message.topic), message.payload)
                        if mapped is not None:
                            await self.hub.broadcast(envelope(mapped["t"], mapped["d"], ts))
                            # evidence log: replay for browsers that join later
                            await evidence.record(self.cfg.evidence_db, mapped)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.connected = False
                self._client = None
                LOG.warning("MQTT bridge down: %s (retry %ss)", exc, backoff)
                await self.hub.broadcast(envelope("toast", {"msg": "MQTT DEGRADED", "sev": "red"}))
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=backoff)
                except asyncio.TimeoutError:
                    pass
                backoff = min(backoff * 2, 5)

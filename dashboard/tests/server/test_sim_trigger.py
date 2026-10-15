"""SIM TOUR relay contract: the dashboard triggers the bus, never drives it.

{sim:"start"|"stop"} is a WS control frame handled like ACK (session + Origin
validated at upgrade) and forwarded to voidmain/sim/*. voidmain/risk/# stays
owned by the feed/engine — see main.py "Never writes voidmain/risk/#".
"""
from types import SimpleNamespace

import aiohttp
import pytest
import pytest_asyncio
from aiohttp import test_utils, web

import server.main as main
from server.auth import SESSION_COOKIE
from server.auth_db import AuthDB
from server.bridge import Bridge
from server.ws_session import SessionWsManager

ORIGIN = "http://localhost:8080"


class StubHub:
    def __init__(self):
        self.sockets = set()

    def add(self, ws):
        self.sockets.add(ws)

    def remove(self, ws):
        self.sockets.discard(ws)

    @property
    def count(self):
        return len(self.sockets)


class StubBridge:
    connected = True

    def __init__(self):
        self.sims = []
        self.acks = []

    async def publish_sim(self, action):
        self.sims.append(action)
        return True

    async def publish_ack(self, aid):
        self.acks.append(aid)
        return True


@pytest.fixture
def tmp_db(tmp_path):
    db = AuthDB(tmp_path / "auth.db")
    db.save_credential("c1", b"\x00" * 32, 0)
    return db


@pytest_asyncio.fixture
async def ctx(tmp_db, monkeypatch):
    async def _empty(*_a, **_k):
        return []
    monkeypatch.setattr(main.db, "read_history", _empty)
    monkeypatch.setattr(main.db, "read_recent_alerts", _empty)

    app = web.Application()
    app["cfg"] = SimpleNamespace(origins=[ORIGIN], evidence_db="unused")
    app["hub"] = StubHub()
    app["bridge"] = StubBridge()
    app["session_mgr"] = SessionWsManager()
    app["auth_db"] = tmp_db
    app.router.add_get("/ws", main.handle_ws)
    async with test_utils.TestClient(test_utils.TestServer(app)) as c:
        yield SimpleNamespace(client=c, app=app, db=tmp_db)


def _hdrs(sid):
    return {"Origin": ORIGIN, "Cookie": f"{SESSION_COOKIE}={sid}"}


async def _read_until(ws, needle, limit=12):
    for _ in range(limit):
        env = await ws.receive_json()
        if needle in str(env):
            return env
    raise AssertionError(f"never saw {needle!r}")


@pytest.mark.asyncio
async def test_sim_start_reaches_bridge_and_toasts(ctx):
    sid = ctx.db.create_session("c1", ttl=3600)
    ws = await ctx.client.ws_connect("/ws", headers=_hdrs(sid))
    await ws.receive_json()  # history
    await ws.send_json({"sim": "start"})
    env = await _read_until(ws, "SIM TOUR")
    assert ctx.app["bridge"].sims == ["start"]
    assert env["t"] == "toast"
    assert env["d"]["sev"] == "green"
    await ws.close()


@pytest.mark.asyncio
async def test_sim_stop_is_relayed_too(ctx):
    sid = ctx.db.create_session("c1", ttl=3600)
    ws = await ctx.client.ws_connect("/ws", headers=_hdrs(sid))
    await ws.receive_json()
    await ws.send_json({"sim": "stop"})
    await _read_until(ws, "stopped")
    assert ctx.app["bridge"].sims == ["stop"]
    await ws.close()


@pytest.mark.asyncio
async def test_sim_without_session_never_reaches_bridge(ctx):
    with pytest.raises(aiohttp.WSServerHandshakeError) as e:
        await ctx.client.ws_connect("/ws", headers={"Origin": ORIGIN})
    assert e.value.status == 401
    assert ctx.app["bridge"].sims == []


class _StubClient:
    def __init__(self):
        self.published = []

    async def publish(self, topic, payload, qos=0, retain=False):
        self.published.append((topic, payload))


def _bridge_with_client():
    b = Bridge(SimpleNamespace(), None)
    b._client = _StubClient()
    b.connected = True
    return b


@pytest.mark.asyncio
async def test_publish_sim_only_writes_sim_topics():
    b = _bridge_with_client()
    assert await b.publish_sim("start") is True
    assert await b.publish_sim("stop") is True
    topics = [t for t, _ in b._client.published]
    assert topics == ["voidmain/sim/start", "voidmain/sim/stop"]
    # the server never authors risk state
    assert not any(t.startswith("voidmain/risk/") for t in topics)


@pytest.mark.asyncio
async def test_publish_sim_rejects_unknown_action_and_offline_bridge():
    b = _bridge_with_client()
    assert await b.publish_sim("reset-everything") is False
    b.connected = False
    assert await b.publish_sim("start") is False
    assert b._client.published == []

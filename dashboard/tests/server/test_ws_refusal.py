"""CP5 WS refusal tests: the /ws upgrade is the security boundary.

No cookie, expired session, wrong Origin, and unauthenticated ACK must all be
refused before any data is sent; a valid session is the positive control.
"""
import asyncio
import hashlib
from types import SimpleNamespace

import aiohttp
import pytest
import pytest_asyncio
from aiohttp import test_utils, web

import server.main as main
from server.auth import SESSION_COOKIE
from server.auth_db import AuthDB
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
        self.acks = []

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


def _hdrs(cookie=None, origin=ORIGIN):
    h = {"Origin": origin} if origin else {}
    if cookie:
        h["Cookie"] = f"{SESSION_COOKIE}={cookie}"
    return h


async def _refused(ctx, status, *, cookie=None, origin=ORIGIN):
    with pytest.raises(aiohttp.WSServerHandshakeError) as e:
        await ctx.client.ws_connect("/ws", headers=_hdrs(cookie, origin))
    assert e.value.status == status
    assert ctx.app["hub"].count == 0


@pytest.mark.asyncio
async def test_valid_session_connects(ctx):
    sid = ctx.db.create_session("c1", ttl=3600)
    ws = await ctx.client.ws_connect("/ws", headers=_hdrs(sid))
    first = await ws.receive_json()
    assert first["t"] == "history"
    await ws.close()


@pytest.mark.asyncio
async def test_no_cookie_refused(ctx):
    await _refused(ctx, 401)


@pytest.mark.asyncio
async def test_forged_cookie_refused(ctx):
    await _refused(ctx, 401, cookie="not-a-real-session")


@pytest.mark.asyncio
async def test_expired_session_refused(ctx):
    sid = ctx.db.create_session("c1", ttl=3600)
    h = hashlib.sha256(sid.encode()).hexdigest()
    ctx.db._db().execute("UPDATE sessions SET expires_at = 0 WHERE id_hash = ?", (h,))
    ctx.db._db().commit()
    await _refused(ctx, 401, cookie=sid)


@pytest.mark.asyncio
async def test_revoked_session_refused(ctx):
    sid = ctx.db.create_session("c1", ttl=3600)
    ctx.db.revoke_session(sid)
    await _refused(ctx, 401, cookie=sid)


@pytest.mark.asyncio
async def test_wrong_origin_refused_even_with_valid_session(ctx):
    sid = ctx.db.create_session("c1", ttl=3600)
    await _refused(ctx, 403, cookie=sid, origin="http://evil.example")


@pytest.mark.asyncio
async def test_missing_origin_refused(ctx):
    sid = ctx.db.create_session("c1", ttl=3600)
    await _refused(ctx, 403, cookie=sid, origin=None)


@pytest.mark.asyncio
async def test_unauthenticated_ack_never_reaches_bridge(ctx):
    await _refused(ctx, 401)
    assert ctx.app["bridge"].acks == []


@pytest.mark.asyncio
async def test_ack_after_session_close_not_published(ctx):
    sid = ctx.db.create_session("c1", ttl=3600)
    ws = await ctx.client.ws_connect("/ws", headers=_hdrs(sid))
    await ws.receive_json()
    h = hashlib.sha256(sid.encode()).hexdigest()
    closer = asyncio.ensure_future(ctx.app["session_mgr"].close_session_sockets(h))
    msg = await ws.receive()
    while msg.type == aiohttp.WSMsgType.TEXT:  # drain the connect-time toast
        msg = await ws.receive()
    await closer
    assert msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED)
    assert ws.close_code == 4401
    assert ctx.app["bridge"].acks == []

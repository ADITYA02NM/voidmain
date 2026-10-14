"""Google sign-in auth tests.

The Google ID-token verifier is monkeypatched at `server.auth._verify_google_token`
so no network access is needed; everything else (rate limits, sessions,
cookies, allowlists, audit) is exercised for real.
"""

import hashlib

import pytest
import pytest_asyncio
from aiohttp import test_utils, web

from server.auth import (
    SESSION_COOKIE, add_auth_routes, reset_rate_limits,
)
from server.auth_db import AuthDB
from server.config import Config, ConfigError, _validate
from server.ws_session import SessionWsManager

CLIENT_ID = "test-client.apps.googleusercontent.com"


# ── Fixtures ─────────────────────────────────────────────────────────────── #

@pytest.fixture(autouse=True)
def _clear_rate():
    reset_rate_limits()
    yield
    reset_rate_limits()


@pytest.fixture
def tmp_db(tmp_path):
    return AuthDB(tmp_path / "auth.db")


def _make_app(tmp_db, *, client_id=CLIENT_ID, owner_emails=None):
    app = web.Application()
    app["auth_db"] = tmp_db
    app["auth_secure_cookies"] = False
    app["google_client_id"] = client_id
    app["owner_emails"] = owner_emails or []
    app["session_mgr"] = SessionWsManager()
    add_auth_routes(app)
    return app


@pytest_asyncio.fixture
async def client(tmp_db):
    app = _make_app(tmp_db)
    async with test_utils.TestClient(test_utils.TestServer(app)) as c:
        yield c


@pytest.fixture
def patch_verifier(monkeypatch):
    """Patch the Google verifier with a factory returning a payload."""
    def _install(payload):
        def _verify(token, audience):
            if isinstance(payload, Exception):
                raise payload
            return payload
        monkeypatch.setattr("server.auth._verify_google_token", _verify)
    return _install


GOOD_PAYLOAD = {
    "sub": "1234567890",
    "email": "owner@example.com",
    "email_verified": True,
    "iss": "https://accounts.google.com",
    "name": "Owner",
    "picture": "",
}


async def _login(client, token="fake-id-token"):
    return await client.post("/auth/google", json={"id_token": token})


# ── Google login ─────────────────────────────────────────────────────────── #

async def test_google_login_success(client, tmp_db, patch_verifier):
    patch_verifier(dict(GOOD_PAYLOAD))
    resp = await _login(client)
    assert resp.status == 200, await resp.text()
    body = await resp.json()
    assert body["status"] == "ok"
    assert body["email"] == "owner@example.com"
    assert SESSION_COOKIE in resp.cookies

    # session works
    sid = resp.cookies[SESSION_COOKIE].value
    st = await client.get("/auth/status", cookies={SESSION_COOKIE: sid})
    assert (await st.json())["authenticated"] is True

    # audit trail
    events = [r["event"] for r in tmp_db.read_audit()]
    assert "google_login" in events


async def test_google_login_bad_token(client, patch_verifier):
    patch_verifier(ValueError("bad token"))
    resp = await _login(client)
    assert resp.status == 401
    assert SESSION_COOKIE not in resp.cookies


async def test_google_login_no_client_id(tmp_db, patch_verifier):
    patch_verifier(dict(GOOD_PAYLOAD))
    app = _make_app(tmp_db, client_id="")
    async with test_utils.TestClient(test_utils.TestServer(app)) as c:
        resp = await _login(c)
        assert resp.status == 503


async def test_google_login_missing_token(client):
    resp = await client.post("/auth/google", json={})
    assert resp.status == 400


async def test_google_login_unverified_email(client, patch_verifier):
    patch_verifier({**GOOD_PAYLOAD, "email_verified": False})
    resp = await _login(client)
    assert resp.status == 401


async def test_owner_allowlist_denied(tmp_db, patch_verifier):
    patch_verifier(dict(GOOD_PAYLOAD))  # owner@example.com
    app = _make_app(tmp_db, owner_emails=["someone-else@example.com"])
    async with test_utils.TestClient(test_utils.TestServer(app)) as c:
        resp = await _login(c)
        assert resp.status == 403


async def test_owner_allowlist_allowed(tmp_db, patch_verifier):
    patch_verifier(dict(GOOD_PAYLOAD))
    app = _make_app(tmp_db, owner_emails=["Owner@Example.com"])
    async with test_utils.TestClient(test_utils.TestServer(app)) as c:
        resp = await _login(c)
        assert resp.status == 200, await resp.text()


# ── Status / logout ──────────────────────────────────────────────────────── #

async def test_auth_status(client):
    resp = await client.get("/auth/status")
    body = await resp.json()
    assert body["has_owner"] is True      # client id configured
    assert body["authenticated"] is False


async def test_auth_status_no_config(tmp_db):
    app = _make_app(tmp_db, client_id="")
    async with test_utils.TestClient(test_utils.TestServer(app)) as c:
        body = await (await c.get("/auth/status")).json()
        assert body["has_owner"] is False


async def test_logout_revokes_session(client, patch_verifier):
    patch_verifier(dict(GOOD_PAYLOAD))
    resp = await _login(client)
    sid = resp.cookies[SESSION_COOKIE].value

    st = await client.get("/auth/status", cookies={SESSION_COOKIE: sid})
    assert (await st.json())["authenticated"] is True

    await client.post("/auth/logout", cookies={SESSION_COOKIE: sid})

    st2 = await client.get("/auth/status", cookies={SESSION_COOKIE: sid})
    assert (await st2.json())["authenticated"] is False


# ── Rate limiting ────────────────────────────────────────────────────────── #

async def test_rate_limiting(client):
    for _ in range(6):
        await _login(client, token="bad")
    resp = await _login(client, token="bad")
    assert resp.status == 429


# ── Session store ────────────────────────────────────────────────────────── #

def test_session_validate_and_expire(tmp_db):
    tmp_db.save_credential("c1", b"\x00" * 32, 0)
    sid = tmp_db.create_session("c1", ttl=3600)
    assert tmp_db.validate_session(sid) is not None

    sid_hash = hashlib.sha256(sid.encode()).hexdigest()
    tmp_db._db().execute("UPDATE sessions SET expires_at = 0 WHERE id_hash = ?", (sid_hash,))
    tmp_db._db().commit()
    assert tmp_db.validate_session(sid) is None


def test_enrollment_token_single_use(tmp_db):
    token = tmp_db.create_enrollment_token(ttl=600)
    assert tmp_db.consume_enrollment_token(token) is True
    assert tmp_db.consume_enrollment_token(token) is False


# ── Config guards ────────────────────────────────────────────────────────── #

def test_config_guard_http_nonlocal():
    cfg = Config(origins=["http://evil.example.com"])
    with pytest.raises(ConfigError):
        _validate(cfg)


def test_config_guard_debug_nonlocal_rp():
    cfg = Config(debug_enabled=True, rp_id="voidmain.example.com")
    with pytest.raises(ConfigError):
        _validate(cfg)


def test_config_guard_ip_rp_id():
    cfg = Config(rp_id="192.168.1.1")
    with pytest.raises(ConfigError):
        _validate(cfg)

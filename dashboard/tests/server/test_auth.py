"""CP4 auth tests — real signed WebAuthn assertions, no mocked verify.

Software authenticator generates ES256 keys, signs challenges, and produces
proper CBOR-encoded attestation objects and assertion responses. py_webauthn
does the actual cryptographic verification.
"""
import hashlib
import json
import os
import struct

import cbor2
import pytest
import pytest_asyncio
from aiohttp import test_utils, web
from cryptography.hazmat.primitives.asymmetric.ec import (
    ECDSA,
    SECP256R1,
    generate_private_key,
)
from cryptography.hazmat.primitives.hashes import SHA256

from webauthn.helpers import bytes_to_base64url

from server.auth import (
    add_auth_routes, SESSION_COOKIE, CEREMONY_COOKIE, reset_rate_limits,
)
from server.auth_db import AuthDB
from server.config import Config, ConfigError, _validate
from server.ws_session import SessionWsManager

RP_ID = "localhost"
ORIGIN = "http://localhost:8080"


# ── Software authenticator ────────────────────────────────────────────────── #

class SoftAuthenticator:
    """Minimal FIDO2 software authenticator for testing."""

    def __init__(self):
        self._key = generate_private_key(SECP256R1())
        self._cred_id = os.urandom(32)
        self._sign_count = 0

    @property
    def credential_id_b64(self):
        return bytes_to_base64url(self._cred_id)

    def _auth_data(self, rp_id, *, attested=False):
        rp_hash = hashlib.sha256(rp_id.encode()).digest()
        flags = 0x01 | 0x04  # UP + UV
        if attested:
            flags |= 0x40  # AT
        self._sign_count += 1
        data = rp_hash + bytes([flags]) + struct.pack(">I", self._sign_count)

        if attested:
            pub = self._key.public_key().public_numbers()
            cose_key = cbor2.dumps({
                1: 2, 3: -7, -1: 1,
                -2: pub.x.to_bytes(32, "big"),
                -3: pub.y.to_bytes(32, "big"),
            })
            data += b"\x00" * 16  # aaguid
            data += struct.pack(">H", len(self._cred_id))
            data += self._cred_id + cose_key

        return data

    def make_registration(self, challenge_b64, rp_id, origin):
        client_data = json.dumps({
            "type": "webauthn.create", "challenge": challenge_b64,
            "origin": origin, "crossOrigin": False,
        }, separators=(",", ":")).encode()
        auth_data = self._auth_data(rp_id, attested=True)
        att_obj = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {
            "id": self.credential_id_b64,
            "rawId": self.credential_id_b64,
            "type": "public-key",
            "response": {
                "attestationObject": bytes_to_base64url(att_obj),
                "clientDataJSON": bytes_to_base64url(client_data),
            },
            "authenticatorAttachment": "platform",
            "clientExtensionResults": {},
        }

    def make_assertion(self, challenge_b64, rp_id, origin):
        client_data = json.dumps({
            "type": "webauthn.get", "challenge": challenge_b64,
            "origin": origin, "crossOrigin": False,
        }, separators=(",", ":")).encode()
        auth_data = self._auth_data(rp_id, attested=False)
        sig = self._key.sign(
            auth_data + hashlib.sha256(client_data).digest(), ECDSA(SHA256()),
        )
        return {
            "id": self.credential_id_b64,
            "rawId": self.credential_id_b64,
            "type": "public-key",
            "response": {
                "authenticatorData": bytes_to_base64url(auth_data),
                "clientDataJSON": bytes_to_base64url(client_data),
                "signature": bytes_to_base64url(sig),
                "userHandle": bytes_to_base64url(b"ultron-owner"),
            },
            "authenticatorAttachment": "platform",
            "clientExtensionResults": {},
        }


# ── Fixtures ──────────────────────────────────────────────────────────────── #

@pytest.fixture(autouse=True)
def _clear_rate():
    reset_rate_limits()
    yield
    reset_rate_limits()


@pytest.fixture
def tmp_db(tmp_path):
    return AuthDB(tmp_path / "auth.db")


@pytest.fixture
def authenticator():
    return SoftAuthenticator()


def _make_app(tmp_db):
    app = web.Application()
    app["auth_db"] = tmp_db
    app["auth_rp_id"] = RP_ID
    app["auth_rp_name"] = "ULTRON"
    app["auth_origins"] = [ORIGIN]
    app["session_mgr"] = SessionWsManager()
    add_auth_routes(app)
    return app


@pytest_asyncio.fixture
async def client(tmp_db):
    app = _make_app(tmp_db)
    async with test_utils.TestClient(test_utils.TestServer(app)) as c:
        yield c


def _challenge(options_json):
    return json.loads(options_json)["challenge"]


async def _register(client, tmp_db, authenticator):
    """Helper: full setup flow, returns session cookie value."""
    token = tmp_db.create_enrollment_token()
    resp = await client.post("/auth/setup", json={"token": token})
    assert resp.status == 200, await resp.text()
    challenge = _challenge(await resp.text())
    cer = {CEREMONY_COOKIE: resp.cookies[CEREMONY_COOKIE].value}
    resp2 = await client.post(
        "/auth/setup/complete",
        json=authenticator.make_registration(challenge, RP_ID, ORIGIN),
        cookies=cer,
    )
    assert resp2.status == 200, await resp2.text()
    return resp2.cookies[SESSION_COOKIE].value


# ── Test 1: full setup flow ───────────────────────────────────────────── #

@pytest.mark.asyncio
async def test_setup_full_flow(client, tmp_db, authenticator):
    sid = await _register(client, tmp_db, authenticator)
    assert sid
    creds = tmp_db.list_credentials()
    assert len(creds) == 1
    assert creds[0].id == authenticator.credential_id_b64


# ── Test 2: login flow ────────────────────────────────────────────────── #

@pytest.mark.asyncio
async def test_login_flow(client, tmp_db, authenticator):
    await _register(client, tmp_db, authenticator)

    resp = await client.post("/auth/login/begin", json={})
    assert resp.status == 200
    challenge = _challenge(await resp.text())
    cer = {CEREMONY_COOKIE: resp.cookies[CEREMONY_COOKIE].value}

    resp2 = await client.post(
        "/auth/login/complete",
        json=authenticator.make_assertion(challenge, RP_ID, ORIGIN),
        cookies=cer,
    )
    assert resp2.status == 200
    assert SESSION_COOKIE in resp2.cookies


# ── Test 3: unknown credential → rejected ─────────────────────────────── #

@pytest.mark.asyncio
async def test_unknown_credential_rejected(client, tmp_db, authenticator):
    await _register(client, tmp_db, authenticator)

    resp = await client.post("/auth/login/begin", json={})
    challenge = _challenge(await resp.text())
    cer = {CEREMONY_COOKIE: resp.cookies[CEREMONY_COOKIE].value}

    other = SoftAuthenticator()
    resp2 = await client.post(
        "/auth/login/complete",
        json=other.make_assertion(challenge, RP_ID, ORIGIN),
        cookies=cer,
    )
    assert resp2.status == 401
    assert any(a["event"] == "unknown_credential" for a in tmp_db.read_audit())


# ── Test 4: revoked credential → no allowable credentials ────────────── #

@pytest.mark.asyncio
async def test_revoked_credential_rejected(client, tmp_db, authenticator):
    await _register(client, tmp_db, authenticator)
    tmp_db.revoke_credential(authenticator.credential_id_b64)

    resp = await client.post("/auth/login/begin", json={})
    assert resp.status == 403


# ── Test 5: expired challenge → rejected ──────────────────────────────── #

@pytest.mark.asyncio
async def test_expired_challenge_rejected(client, tmp_db, authenticator):
    token = tmp_db.create_enrollment_token()
    resp = await client.post("/auth/setup", json={"token": token})
    challenge = _challenge(await resp.text())
    ceremony_id = resp.cookies[CEREMONY_COOKIE].value

    tmp_db._db().execute("UPDATE challenges SET expires_at = 0")
    tmp_db._db().commit()

    resp2 = await client.post(
        "/auth/setup/complete",
        json=authenticator.make_registration(challenge, RP_ID, ORIGIN),
        cookies={CEREMONY_COOKIE: ceremony_id},
    )
    assert resp2.status == 400


# ── Test 6: replayed challenge → rejected ─────────────────────────────── #

@pytest.mark.asyncio
async def test_replayed_challenge_rejected(client, tmp_db, authenticator):
    token = tmp_db.create_enrollment_token()
    resp = await client.post("/auth/setup", json={"token": token})
    challenge = _challenge(await resp.text())
    ceremony_id = resp.cookies[CEREMONY_COOKIE].value
    cer = {CEREMONY_COOKIE: ceremony_id}

    resp1 = await client.post(
        "/auth/setup/complete",
        json=authenticator.make_registration(challenge, RP_ID, ORIGIN),
        cookies=cer,
    )
    assert resp1.status == 200

    auth2 = SoftAuthenticator()
    resp2 = await client.post(
        "/auth/setup/complete",
        json=auth2.make_registration(challenge, RP_ID, ORIGIN),
        cookies=cer,
    )
    assert resp2.status == 400


# ── Test 7: counter regression → rejected ─────────────────────────────── #

@pytest.mark.asyncio
async def test_counter_regression_rejected(client, tmp_db, authenticator):
    await _register(client, tmp_db, authenticator)

    # Login once to advance counter
    resp = await client.post("/auth/login/begin", json={})
    challenge = _challenge(await resp.text())
    cer = {CEREMONY_COOKIE: resp.cookies[CEREMONY_COOKIE].value}
    await client.post(
        "/auth/login/complete",
        json=authenticator.make_assertion(challenge, RP_ID, ORIGIN),
        cookies=cer,
    )

    # Force counter higher than authenticator will produce
    tmp_db._db().execute("UPDATE credentials SET sign_count = 99999")
    tmp_db._db().commit()

    reset_rate_limits()
    resp2 = await client.post("/auth/login/begin", json={})
    c2 = _challenge(await resp2.text())
    cer2 = {CEREMONY_COOKIE: resp2.cookies[CEREMONY_COOKIE].value}
    resp3 = await client.post(
        "/auth/login/complete",
        json=authenticator.make_assertion(c2, RP_ID, ORIGIN),
        cookies=cer2,
    )
    assert resp3.status == 401
    events = [a["event"] for a in tmp_db.read_audit()]
    assert "counter_regression" in events or "login_verify_failed" in events


# ── Test 8: session validate + expire ─────────────────────────────────── #

@pytest.mark.asyncio
async def test_session_validate_and_expire(tmp_db):
    tmp_db.save_credential("c1", b"\x00" * 32, 0)
    sid = tmp_db.create_session("c1", ttl=3600)
    assert tmp_db.validate_session(sid) is not None

    sid_hash = hashlib.sha256(sid.encode()).hexdigest()
    tmp_db._db().execute("UPDATE sessions SET expires_at = 0 WHERE id_hash = ?", (sid_hash,))
    tmp_db._db().commit()
    assert tmp_db.validate_session(sid) is None


# ── Test 9: rate limiting ─────────────────────────────────────────────── #

@pytest.mark.asyncio
async def test_rate_limiting(client, tmp_db):
    for _ in range(6):
        await client.post("/auth/setup", json={"token": "bad"})
    resp = await client.post("/auth/setup", json={"token": "bad"})
    assert resp.status == 429


# ── Test 10: enrollment token single-use ──────────────────────────────── #

def test_enrollment_token_single_use(tmp_db):
    token = tmp_db.create_enrollment_token(ttl=600)
    assert tmp_db.consume_enrollment_token(token) is True
    assert tmp_db.consume_enrollment_token(token) is False


# ── Test 11: setup with bad token → 403 ──────────────────────────────── #

@pytest.mark.asyncio
async def test_setup_bad_token(client, tmp_db):
    resp = await client.post("/auth/setup", json={"token": "nonexistent"})
    assert resp.status == 403


# ── Test 12: auth status ──────────────────────────────────────────────── #

@pytest.mark.asyncio
async def test_auth_status(client, tmp_db):
    resp = await client.get("/auth/status")
    body = await resp.json()
    assert body["has_owner"] is False
    assert body["authenticated"] is False


# ── Test 13: logout revokes session ───────────────────────────────────── #

@pytest.mark.asyncio
async def test_logout_revokes_session(client, tmp_db, authenticator):
    sid = await _register(client, tmp_db, authenticator)

    resp = await client.get("/auth/status", cookies={SESSION_COOKIE: sid})
    assert (await resp.json())["authenticated"] is True

    await client.post("/auth/logout", cookies={SESSION_COOKIE: sid})

    resp2 = await client.get("/auth/status", cookies={SESSION_COOKIE: sid})
    assert (await resp2.json())["authenticated"] is False


# ── Test 14: config guard — non-localhost http origin ─────────────────── #

def test_config_guard_http_nonlocal():
    cfg = Config(origins=["http://evil.example.com"])
    with pytest.raises(ConfigError):
        _validate(cfg)


# ── Test 15: config guard — debug + non-localhost RP ID ───────────────── #

def test_config_guard_debug_nonlocal_rp():
    cfg = Config(debug_enabled=True, rp_id="ultron.example.com")
    with pytest.raises(ConfigError):
        _validate(cfg)


# ── Test 16: config guard — IP address as RP ID ──────────────────────── #

def test_config_guard_ip_rp_id():
    cfg = Config(rp_id="192.168.1.1")
    with pytest.raises(ConfigError):
        _validate(cfg)


# ── Test 17: list credentials requires session ───────────────────────── #

@pytest.mark.asyncio
async def test_list_credentials_requires_session(client):
    resp = await client.get("/auth/credentials")
    assert resp.status == 401


# ── Test 18: list credentials authenticated ───────────────────────────── #

@pytest.mark.asyncio
async def test_list_credentials_authenticated(client, tmp_db, authenticator):
    sid = await _register(client, tmp_db, authenticator)
    resp = await client.get("/auth/credentials", cookies={SESSION_COOKIE: sid})
    assert resp.status == 200
    creds = await resp.json()
    assert len(creds) == 1
    assert creds[0]["id"] == authenticator.credential_id_b64


# ── Test 19: cannot revoke last credential ────────────────────────────── #

@pytest.mark.asyncio
async def test_cannot_revoke_last_credential(client, tmp_db, authenticator):
    sid = await _register(client, tmp_db, authenticator)
    resp = await client.delete(
        f"/auth/credentials/{authenticator.credential_id_b64}",
        cookies={SESSION_COOKIE: sid},
    )
    assert resp.status == 409

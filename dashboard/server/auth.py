"""VoidMain Google authentication routes (core console).

Owner signs in with a Google account. The browser obtains an OIDC ID
token from Google Identity Services and POSTs it here; the server
verifies the token against Google's public keys and issues a local
session cookie. No passwords or passkeys are stored.

Route table (all under /auth/):
  POST /auth/google    verify Google ID token, start session
  POST /auth/logout    end session
  GET  /auth/status    session state
"""

from __future__ import annotations

import hashlib
import logging
import time
from collections import defaultdict

from aiohttp import web
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from .auth_db import AuthDB

LOG = logging.getLogger("voidmain.auth")

SESSION_COOKIE = "voidmain_session"
SESSION_TTL = 3600  # 1 hour

GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")

# ── Rate limiting ─────────────────────────────────────────────────────────── #

_rate: dict[str, list[float]] = defaultdict(list)
_RATE_WINDOW = 300  # 5 minutes
_RATE_MAX = 5


def reset_rate_limits() -> None:
    _rate.clear()


def _check_rate(ip: str, auth_db: AuthDB) -> bool:
    now = time.time()
    attempts = _rate[ip]
    _rate[ip] = [t for t in attempts if now - t < _RATE_WINDOW]
    if len(_rate[ip]) >= _RATE_MAX:
        backoff = 2 ** (len(_rate[ip]) - _RATE_MAX)
        if _rate[ip] and (now - _rate[ip][-1]) < backoff:
            auth_db.audit("rate_limited", ip=ip)
            return False
    _rate[ip].append(now)
    return True


def _rate_guard(request: web.Request, auth_db: AuthDB) -> None:
    ip = request.remote or "unknown"
    if not _check_rate(ip, auth_db):
        raise web.HTTPTooManyRequests(text="Rate limited")


# ── Helpers ───────────────────────────────────────────────────────────────── #

def _get_auth_db(request: web.Request) -> AuthDB:
    return request.app["auth_db"]


def _get_google_client_id(request: web.Request) -> str:
    return request.app.get("google_client_id", "")


def _get_owner_emails(request: web.Request) -> list[str]:
    return request.app.get("owner_emails") or []


def _secure_cookies(request: web.Request) -> bool:
    return request.app.get("auth_secure_cookies", False)


def _set_session_cookie(
    resp: web.Response, sid: str,
    *, secure: bool = False,
) -> None:
    resp.set_cookie(
        SESSION_COOKIE, sid,
        max_age=SESSION_TTL, httponly=True,
        samesite="Strict", secure=secure, path="/",
    )


def _clear_session_cookie(resp: web.Response) -> None:
    resp.del_cookie(SESSION_COOKIE, path="/")


def _require_session(request: web.Request) -> str:
    sid = request.cookies.get(SESSION_COOKIE)
    if not sid:
        raise web.HTTPUnauthorized(text="No session")
    auth_db = _get_auth_db(request)
    session = auth_db.validate_session(sid)
    if not session:
        raise web.HTTPUnauthorized(text="Invalid or expired session")
    return sid


# ── Google ID token verification ──────────────────────────────────────────── #

def _verify_google_token(id_token: str, client_id: str) -> dict:
    """Fetch/verify a Google OIDC ID token against Google's public keys.

    Returns the raw payload; claim checks (issuer, email_verified) live in
    the handler so tests can monkeypatch this network boundary only.
    """
    return google_id_token.verify_oauth2_token(
        id_token, google_requests.Request(), audience=client_id,
    )


# ── Google sign-in ────────────────────────────────────────────────────────── #

async def handle_google(request: web.Request) -> web.Response:
    auth_db = _get_auth_db(request)
    _rate_guard(request, auth_db)

    client_id = _get_google_client_id(request)
    if not client_id:
        raise web.HTTPServiceUnavailable(
            text="Google sign-in not configured (GOOGLE_CLIENT_ID missing)"
        )

    try:
        body = await request.json()
    except Exception as e:
        raise web.HTTPBadRequest(text="JSON body required") from e

    token = body.get("id_token") or body.get("credential") or ""
    if not token or not isinstance(token, str):
        raise web.HTTPBadRequest(text="id_token required")

    ip = request.remote or "unknown"
    try:
        info = _verify_google_token(token, client_id)
        if info.get("iss") not in GOOGLE_ISSUERS:
            raise ValueError(f"unexpected issuer: {info.get('iss')!r}")
        if not info.get("email_verified"):
            raise ValueError("email not verified")
        if not info.get("sub") or not info.get("email"):
            raise ValueError("missing sub or email claim")
    except Exception as e:
        auth_db.audit("google_auth_failed", ip=ip, detail=str(e)[:200])
        LOG.warning("google auth failed: %s", e)
        raise web.HTTPUnauthorized(text="Google authentication failed") from e

    email = str(info["email"]).lower()
    allowed = {e.lower() for e in _get_owner_emails(request)}
    if allowed and email not in allowed:
        auth_db.audit("google_email_denied", ip=ip, detail=email)
        raise web.HTTPForbidden(text="This Google account is not authorised")

    sid = auth_db.create_session(info["sub"], ip=ip, ttl=SESSION_TTL)
    auth_db.audit("google_login", ip=ip, credential_id=info["sub"], detail=email)
    LOG.info("google login: %s", email)

    resp = web.json_response({
        "status": "ok",
        "email": email,
        "name": info.get("name", ""),
        "picture": info.get("picture", ""),
    })
    _set_session_cookie(resp, sid, secure=_secure_cookies(request))
    return resp


# ── Logout ────────────────────────────────────────────────────────────────── #

async def handle_logout(request: web.Request) -> web.Response:
    sid = request.cookies.get(SESSION_COOKIE)
    auth_db = _get_auth_db(request)
    if sid:
        auth_db.revoke_session(sid)
        auth_db.audit("logout", ip=request.remote)
        # Close all WebSockets for this session
        session_mgr = request.app.get("session_mgr")
        if session_mgr:
            sid_hash = hashlib.sha256(sid.encode()).hexdigest()
            await session_mgr.close_session_sockets(sid_hash)
    resp = web.json_response({"status": "ok"})
    _clear_session_cookie(resp)
    return resp


# ── Auth status ───────────────────────────────────────────────────────────── #

async def handle_auth_status(request: web.Request) -> web.Response:
    auth_db = _get_auth_db(request)
    sid = request.cookies.get(SESSION_COOKIE)
    authenticated = False
    if sid:
        session = auth_db.validate_session(sid)
        authenticated = session is not None
    return web.json_response({
        "has_owner": bool(_get_google_client_id(request)),
        "authenticated": authenticated,
    })


# ── Route registration ───────────────────────────────────────────────────── #

def add_auth_routes(app: web.Application) -> None:
    app.add_routes([
        web.post("/auth/google", handle_google),
        web.post("/auth/logout", handle_logout),
        web.get("/auth/status", handle_auth_status),
    ])

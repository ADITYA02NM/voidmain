"""VoidMain Google authentication routes (core console).

Owner signs in with a Google account, usually from their phone.
Primary flow is QR device-pairing: the dashboard shows a QR + short
code; the phone opens /auth/approve, completes Google sign-in
(biometrics/passcode via Google), and the desktop polls /auth/poll to
pick up the resulting session cookie. A direct POST /auth/google is
also available for same-device sign-in. No passwords or passkeys are
stored.

Route table (all under /auth/):
  POST /auth/google             verify Google ID token, start session
  POST /auth/qr                 issue pairing code + URL (phone flow)
  GET  /auth/qr.svg             QR image for a pairing URL
  GET  /auth/approve            phone page: Continue with Google
  POST /auth/approve/complete   phone posts verified Google id_token
  POST /auth/poll               desktop polls code → session cookie
  POST /auth/logout             end session
  GET  /auth/status             session state
"""

from __future__ import annotations

import hashlib
import html as html_mod
import logging
import os
import secrets
import socket
import time
from collections import defaultdict
from io import BytesIO

from aiohttp import web
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from qrcode import QRCode
from qrcode.image.svg import SvgPathImage

from . import csp as csp_mod
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

    info, email = await _verify_body_token(request, auth_db)

    sid = auth_db.create_session(info["sub"], ip=request.remote or "unknown",
                                 ttl=SESSION_TTL)
    auth_db.audit("google_login", ip=request.remote, credential_id=info["sub"], detail=email)
    LOG.info("google login: %s", email)

    resp = web.json_response({
        "status": "ok",
        "email": email,
        "name": info.get("name", ""),
        "picture": info.get("picture", ""),
    })
    _set_session_cookie(resp, sid, secure=_secure_cookies(request))
    return resp


# ── QR device-pairing (phone Google sign-in → desktop session) ────────────── #

CODE_TTL = 300          # 5 minutes to scan + approve
CODE_LEN = 8
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L
_PENDING_MAX = 32

# code -> {created, expires, status: "pending"|"approved", sid, email}
_pending: dict[str, dict] = {}


def reset_pending() -> None:
    """Clear pairing codes (tests)."""
    _pending.clear()


def _cleanup_pending() -> None:
    now = time.time()
    for code in [c for c, rec in _pending.items() if now > rec["expires"]]:
        del _pending[code]


def _new_pending_code() -> str:
    _cleanup_pending()
    while len(_pending) >= _PENDING_MAX:
        oldest = min(_pending, key=lambda c: _pending[c]["created"])
        del _pending[oldest]
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))
        if code not in _pending:
            return code


def _lan_ip() -> str:
    """Best-effort primary LAN IPv4 (UDP connect sends no packets)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        return ip or "127.0.0.1"
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def _public_base(request: web.Request) -> str:
    """Base URL the phone can reach — never localhost (that's the desktop)."""
    host = os.environ.get("VOIDMAIN_PUBLIC_HOST", "").strip()
    if not host:
        detected = _lan_ip()
        host = "127.0.0.1" if detected.startswith("127.") else detected
    if ":" in host and not host.startswith("["):
        # host:port given — keep as-is
        return f"http://{host}"
    cfg = request.app.get("cfg")
    port = getattr(cfg, "http_port", None) or int(os.environ.get("VOIDMAIN_HTTP_PORT", "8081"))
    return f"http://{host}:{port}"


def _get_pending(request: web.Request, code: str) -> dict:
    code = (code or "").strip().upper()
    rec = _pending.get(code)
    if rec is None or time.time() > rec["expires"]:
        if code in _pending:
            del _pending[code]
        raise web.HTTPGone(text="This sign-in code expired. Generate a new one on the dashboard.")
    return rec


async def _verify_body_token(request: web.Request, auth_db: AuthDB) -> tuple[dict, str]:
    """Shared Google-token verification for /auth/google and approve/complete.

    Returns (info, email_lower). Raises 400/401/403/503 as appropriate.
    """
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
    return info, email


async def handle_qr(request: web.Request) -> web.Response:
    """Issue a short pairing code + phone-reachable approve URL."""
    auth_db = _get_auth_db(request)
    _rate_guard(request, auth_db)
    code = _new_pending_code()
    now = time.time()
    _pending[code] = {
        "created": now, "expires": now + CODE_TTL,
        "status": "pending", "sid": None, "email": "",
    }
    url = f"{_public_base(request)}/auth/approve?code={code}"
    auth_db.audit("qr_issued", ip=request.remote, detail=code)
    return web.json_response({"code": code, "url": url, "expires_in": CODE_TTL})


async def handle_qr_svg(request: web.Request) -> web.Response:
    """Serve an SVG QR image for a pairing URL (phone scans this)."""
    u = request.query.get("u", "")
    if not u.startswith(("http://", "https://")) or len(u) > 300:
        raise web.HTTPBadRequest(text="u must be an http(s) URL")
    qr = QRCode(image_factory=SvgPathImage)
    qr.add_data(u)
    qr.make(fit=True)
    buf = BytesIO()
    qr.make_image().save(buf)
    return web.Response(
        body=buf.getvalue(), content_type="image/svg+xml",
        headers={"Cache-Control": "no-store"},
    )


def _approve_html(code: str, client_id: str, *, approved_email: str = "") -> str:
    code_esc = html_mod.escape(code)
    if approved_email:
        return (
            "<!doctype html><html><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            "<title>VoidMain — signed in</title></head><body style=\""
            "font-family:system-ui,sans-serif;background:#0A0A0F;color:#e8e8f0;"
            "display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0\">"
            "<div style=\"text-align:center;padding:2rem\">"
            "<h1 style=\"font-size:1.5rem;margin:0 0 .5rem\">Void<b style=\"color:#8A2BE2\">Main</b></h1>"
            f"<p style=\"color:#14E0C8;margin:0 0 .25rem\">Signed in</p>"
            f"<p style=\"color:#8b8ba0;font-size:.9rem\">{html_mod.escape(approved_email)}</p>"
            "<p style=\"color:#8b8ba0;font-size:.9rem\">Return to the dashboard — it unlocks automatically.</p>"
            "</div></body></html>"
        )
    cid_esc = html_mod.escape(client_id)
    if client_id:
        btnbox = (
            "<div id=\"btnbox\">"
            "<div id=\"g_id_onload\" data-client_id=\"" + cid_esc + "\" "
            "data-callback=\"vmApprove\" data-auto_prompt=\"false\"></div>"
            "<div class=\"g_id_signin\" data-type=\"standard\" data-size=\"large\"></div>"
            "</div>"
        )
        gsi = "<script src=\"https://accounts.google.com/gsi/client\" async defer></script>"
    else:
        # Dev mode (no GOOGLE_CLIENT_ID): one-tap approve so the demo flow works.
        btnbox = (
            "<div id=\"btnbox\">"
            "<button id=\"devbtn\" style=\"font-size:1.05rem;font-weight:600;padding:.85rem 2rem;"
            "border:0;border-radius:10px;background:#8A2BE2;color:#fff;cursor:pointer\">"
            "Approve sign-in</button>"
            "</div>"
        )
        gsi = ""
    return (
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        "<title>VoidMain — approve sign-in</title></head><body style=\""
        "font-family:system-ui,sans-serif;background:#0A0A0F;color:#e8e8f0;margin:0\">"
        "<div style=\"max-width:24rem;margin:0 auto;padding:3rem 1.25rem;text-align:center\">"
        "<h1 style=\"font-size:1.5rem;margin:0 0 .5rem\">Void<b style=\"color:#8A2BE2\">Main</b></h1>"
        "<p style=\"color:#8b8ba0;margin:0 0 .25rem\">Approve this dashboard sign-in</p>"
        f"<p style=\"font-family:ui-monospace,monospace;font-size:1.6rem;letter-spacing:.35em;"
        f"color:#14E0C8;margin:.5rem 0 1.5rem\">{code_esc}</p>"
        + btnbox +
        "<p id=\"msg\" style=\"color:#8b8ba0;font-size:.9rem;margin-top:1.25rem;min-height:1.2em\"></p>"
        "</div>"
        + gsi +
        "<script>"
        "async function vmApprove(resp) {"
        "  var msg = document.getElementById('msg');"
        "  msg.textContent = 'Verifying…';"
        "  try {"
        "    var body = {code: " + repr(code_esc) + "};"
        "    if (resp && resp.credential) body.id_token = resp.credential;"
        "    var r = await fetch('/auth/approve/complete', {"
        "      method: 'POST', headers: {'Content-Type': 'application/json'},"
        "      credentials: 'same-origin',"
        "      body: JSON.stringify(body)"
        "    });"
        "    if (!r.ok) { msg.textContent = 'Failed: ' + (await r.text()); return; }"
        "    document.getElementById('btnbox').style.display = 'none';"
        "    msg.textContent = 'Signed in. Return to the VoidMain dashboard.';"
        "  } catch (e) { msg.textContent = 'Network error — try again.'; }"
        "}"
        "var db = document.getElementById('devbtn');"
        "if (db) db.onclick = function() { vmApprove(null); };"
        "</script></body></html>"
    )


async def handle_approve(request: web.Request) -> web.Response:
    """Phone-facing page: Continue with Google (biometrics via Google)."""
    code = (request.query.get("code") or "").strip().upper()
    client_id = _get_google_client_id(request)
    rec = _pending.get(code)
    approved_email = ""
    if rec is not None:
        if time.time() > rec["expires"]:
            del _pending[code]
            rec = None
        elif rec["status"] == "approved":
            approved_email = rec["email"]
    if rec is None and not approved_email:
        raise web.HTTPGone(
            text="This sign-in code expired. Generate a new one on the dashboard."
        )
    html = _approve_html(code, client_id, approved_email=approved_email)
    resp = web.Response(text=html, content_type="text/html")
    resp.headers["Cache-Control"] = "no-store"
    csp_mod.apply(resp, csp_mod.build_csp_for_html(html))
    return resp


async def handle_approve_complete(request: web.Request) -> web.Response:
    """Phone posts the Google id_token; the pairing code is marked approved."""
    auth_db = _get_auth_db(request)
    _rate_guard(request, auth_db)
    try:
        body = await request.json()
    except Exception as e:
        raise web.HTTPBadRequest(text="JSON body required") from e
    code = str(body.get("code", "")).strip().upper()
    rec = _get_pending(request, code)

    client_id = _get_google_client_id(request)
    if client_id:
        # Real Google auth — verify the id_token from the phone.
        info, email = await _verify_body_token(request, auth_db)
        sub = info["sub"]
    else:
        # Dev mode — no Google client ID configured; approve unconditionally.
        sub = "dev-owner"
        email = "dev@voidmain.local"

    sid = auth_db.create_session(sub, ip=request.remote or "unknown",
                                 ttl=SESSION_TTL)
    rec.update(status="approved", sid=sid, email=email)
    auth_db.audit("google_login", ip=request.remote, credential_id=sub,
                  detail=f"qr:{email}")
    LOG.info("qr approve: %s", email)
    return web.json_response({"status": "ok", "email": email})


async def handle_poll(request: web.Request) -> web.Response:
    """Desktop polls the pairing code; on approval receives the session."""
    auth_db = _get_auth_db(request)
    try:
        body = await request.json()
    except Exception as e:
        raise web.HTTPBadRequest(text="JSON body required") from e
    code = str(body.get("code", "")).strip().upper()
    rec = _get_pending(request, code)

    if rec["status"] != "approved":
        return web.json_response({"status": "pending"})

    sid = rec["sid"]
    email = rec["email"]
    del _pending[code]  # one-time handoff
    auth_db.audit("qr_login", ip=request.remote, detail=email)
    resp = web.json_response({
        "status": "ok", "authenticated": True, "email": email,
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
        web.post("/auth/qr", handle_qr),
        web.get("/auth/qr.svg", handle_qr_svg),
        web.get("/auth/approve", handle_approve),
        web.post("/auth/approve/complete", handle_approve_complete),
        web.post("/auth/poll", handle_poll),
        web.post("/auth/logout", handle_logout),
        web.get("/auth/status", handle_auth_status),
    ])

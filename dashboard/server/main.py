"""VoidMain dashboard web server (Pi4 — GOVERNANCE).

Routes: /  /assets/*  /debug.html  /debug/triggers  /debug/trigger  /ws
/healthz  /ai/ask  /auth/* (+ /favicon.ico and a SPA fallback — justified in use.md).

Serves the built React app, bridges MQTT<->/ws, replays history + acked alerts
on join, handles ACK, SIM-tour triggers and clock-sync control frames. Never
writes voidmain/risk/# (the SIM trigger goes out on voidmain/sim/# only).
WebSocket upgrade requires valid session + Origin header.

TLS: when VOIDMAIN_TLS_CERT + VOIDMAIN_TLS_KEY are set, serves HTTPS on
VOIDMAIN_HTTPS_PORT (default 443). Plain HTTP on VOIDMAIN_HTTP_PORT redirects
to the HTTPS origin with 301.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import ipaddress
import json
import logging
import os
import ssl
import time
from pathlib import Path

from aiohttp import WSMsgType, web

from . import clock, csp, db, rag, triggers
from .auth import add_auth_routes
from .auth_db import AuthDB
from .bridge import Bridge, Hub, envelope
from .config import Config, load
from .ws_session import SessionWsManager

LOG = logging.getLogger("voidmain.main")
_START = time.monotonic()


# --------------------------------------------------------------------------- #
# Debug gating
# --------------------------------------------------------------------------- #
def _ip_in(ip: str, subnet: str) -> bool:
    try:
        return ipaddress.ip_address(ip) in ipaddress.ip_network(subnet, strict=False)
    except ValueError:
        return False


def _check_basic(request: web.Request, user: str, pw: str) -> bool:
    hdr = request.headers.get("Authorization", "")
    if not hdr.startswith("Basic "):
        return False
    try:
        raw = base64.b64decode(hdr[6:]).decode("utf-8")
        u, _, p = raw.partition(":")
    except Exception:  # noqa: BLE001
        return False
    return u == user and p == pw


def _debug_gate(request: web.Request, cfg: Config) -> None:
    """Raise 404/401 unless debug is permitted for this client."""
    ip = request.remote or ""
    in_mgmt = _ip_in(ip, cfg.mgmt_subnet)
    if not (cfg.debug_enabled or in_mgmt):
        raise web.HTTPNotFound()
    if cfg.debug_pass:
        if not _check_basic(request, cfg.debug_user, cfg.debug_pass):
            raise web.HTTPUnauthorized(headers={"WWW-Authenticate": 'Basic realm="voidmain"'})
    elif not cfg.debug_enabled:
        # Reached via mgmt subnet but no password configured -> fail safe.
        raise web.HTTPNotFound()


# --------------------------------------------------------------------------- #
# HTTP handlers
# --------------------------------------------------------------------------- #
async def handle_index(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    if not cfg.dist_index.exists():
        raise web.HTTPNotFound(text="frontend not built; run: make build (vite build)")
    resp = web.Response(text=cfg.dist_index.read_text(encoding="utf-8"),
                        content_type="text/html", charset="utf-8")
    resp.headers["Cache-Control"] = "no-store"
    if cfg.tls_enabled:
        resp.headers["Strict-Transport-Security"] = "max-age=31536000"
    return csp.apply(resp, request.app["csp_app"])


async def handle_asset(request: web.Request) -> web.StreamResponse:
    cfg: Config = request.app["cfg"]
    tail = request.match_info.get("tail", "")
    target = (cfg.dist_dir / "assets" / tail).resolve()
    assets_root = (cfg.dist_dir / "assets").resolve()
    if assets_root != target and assets_root not in target.parents:
        raise web.HTTPNotFound()
    if not target.is_file():
        raise web.HTTPNotFound()
    resp = web.FileResponse(target)
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return csp.apply(resp, request.app["csp_app"])


async def handle_spa(request: web.Request) -> web.Response:
    # SPA fallback for unknown same-origin paths (justified in use.md).
    return await handle_index(request)


async def handle_favicon(request: web.Request) -> web.StreamResponse:
    cfg: Config = request.app["cfg"]
    fav = cfg.dist_dir / "favicon.ico"
    if fav.is_file():
        return csp.apply(web.FileResponse(fav), request.app["csp_app"])
    return web.Response(status=204)


async def handle_debug(request: web.Request) -> web.Response:
    cfg: Config = request.app["cfg"]
    _debug_gate(request, cfg)
    page = request.app.get("debug_page")
    if page is None:
        raise web.HTTPNotFound(text="debug.html missing")
    body, policy = page
    resp = web.Response(text=body, content_type="text/html", charset="utf-8")
    resp.headers["Cache-Control"] = "no-store"
    return csp.apply(resp, policy)


async def handle_debug_triggers(request: web.Request) -> web.Response:
    """Button catalogue for debug.html — session-gated, read-only."""
    if not _ws_session(request):
        raise web.HTTPUnauthorized(text="Valid session required")
    return web.json_response(triggers.catalogue(),
                             headers={"Cache-Control": "no-store"})


async def handle_debug_trigger(request: web.Request) -> web.Response:
    """Relay one demo trigger onto voidmain/sim/<id> (session-gated).

    The server never writes voidmain/risk/#: the dev-only director executes the
    trigger, so dashboard, debug console and ESP32 OLED all show one stream.
    """
    if not _ws_session(request):
        raise web.HTTPUnauthorized(text="Valid session required")
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="JSON body required")
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="JSON object body required")
    tid = str(body.get("id", ""))[:64]
    ok, reason = triggers.validate(tid, body.get("v"), body.get("s"))
    if not ok:
        raise web.HTTPBadRequest(text=reason)
    payload: dict = {"ts": int(time.time()), "op": "debug"}
    if tid.startswith("preset/") or body.get("v") is not None:
        payload["v"] = body.get("v") if body.get("v") is not None else None
    if body.get("s") is not None:
        payload["s"] = body["s"]
    bridge: Bridge = request.app["bridge"]
    if not await bridge.publish_sim(tid, payload):
        raise web.HTTPServiceUnavailable(text="MQTT bridge offline")
    LOG.debug("trigger %s -> voidmain/sim/%s", tid, tid)
    return web.json_response({"ok": True, "topic": f"voidmain/sim/{tid}"})


async def handle_ai_ask(request: web.Request) -> web.Response:
    """Console assistant: BM25 over the repo docs + local Ollama (zero cloud).

    Always answers: model mode when Ollama replies, otherwise a labelled
    retrieval-only answer. Session-gated like /ws so only signed-in operators
    can spend model time.
    """
    if not _ws_session(request):
        raise web.HTTPUnauthorized(text="Valid session required")
    cfg: Config = request.app["cfg"]
    if not cfg.ai_enabled:
        raise web.HTTPNotFound(text="assistant disabled (VOIDMAIN_AI=0)")
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="JSON body required")
    query = " ".join(str(body.get("q", "")).split())[:500]
    if not query:
        raise web.HTTPBadRequest(text="missing q")

    # live dashboard state, so answers reflect what is on screen right now
    hist = await db.read_history(cfg.evidence_db)
    alerts = await db.read_recent_alerts(cfg.evidence_db)
    bridge: Bridge = request.app["bridge"]
    score = hist[-1][1] if hist else None
    live: dict = {
        "score": score,
        "band": triggers.band_for_score(score) if score is not None else None,
        "mqtt": bridge.connected,
        "ws_clients": request.app["hub"].count,
        "uptime_s": round(time.monotonic() - _START, 1),
        "open_alerts": [f"{a['sev']}: {a['title']}" for a in alerts if not a["ack"]][:3],
    }
    out = await asyncio.to_thread(
        rag.ask, query, live,
        ollama_url=cfg.ollama_url, model=cfg.ai_model, timeout=cfg.ai_timeout,
    )
    return web.json_response(out, headers={"Cache-Control": "no-store"})


async def handle_ai_models(request: web.Request) -> web.Response:
    """Lightweight liveness hint for the AI console: which model is available.

    Cheap GET so the panel can show a correct status dot without spending model
    time, and without a prompt. Still session-gated.
    """
    if not _ws_session(request):
        raise web.HTTPUnauthorized(text="Valid session required")
    cfg: Config = request.app["cfg"]
    if not cfg.ai_enabled:
        raise web.HTTPNotFound(text="assistant disabled (VOIDMAIN_AI=0)")
    models = await asyncio.to_thread(rag.list_models, cfg.ollama_url)
    active = any(m.get("name") == cfg.ai_model for m in models)
    return web.json_response({
        "enabled": cfg.ai_enabled,
        "model": cfg.ai_model,
        "active": active,
        "models": models,
    }, headers={"Cache-Control": "no-store"})


async def handle_alerts(request: web.Request) -> web.Response:
    """Phone-friendly alert feed: all recent alerts, session-gated, cached 2s."""
    if not _ws_session(request):
        raise web.HTTPUnauthorized(text="Valid session required")
    cfg: Config = request.app["cfg"]
    alerts = await db.read_recent_alerts(cfg.evidence_db)
    return web.json_response({"alerts": alerts, "count": len(alerts)},
                             headers={"Cache-Control": "public, max-age=2"})


async def handle_alerts_page(request: web.Request) -> web.Response:
    """Phone-friendly standalone alerts page — session-gated."""
    if not _ws_session(request):
        raise web.HTTPUnauthorized(text="Valid session required")
    page = request.app.get("alerts_page")
    if page is None:
        raise web.HTTPNotFound(text="alerts.html missing")
    body, policy = page
    resp = web.Response(text=body, content_type="text/html", charset="utf-8")
    resp.headers["Cache-Control"] = "no-store"
    return csp.apply(resp, policy)


async def handle_healthz(request: web.Request) -> web.Response:
    app = request.app
    cfg: Config = app["cfg"]
    bridge: Bridge = app["bridge"]
    body = {
        "ok": True,
        "mqtt_connected": bool(bridge.connected),
        "db_readable": await db.db_readable(cfg.evidence_db),
        "uptime_s": round(time.monotonic() - _START, 1),
        "version": cfg.version,
        "ws_clients": app["hub"].count,
    }
    return web.json_response(body, headers={"Cache-Control": "no-store"})


# --------------------------------------------------------------------------- #
# WebSocket
# --------------------------------------------------------------------------- #
def _validate_ws_origin(request: web.Request, origins: list[str]) -> bool:
    origin = request.headers.get("Origin", "")
    return origin in origins


def _ws_session(request: web.Request) -> str | None:
    """Validate session cookie on WS upgrade. Returns sid_hash or None."""
    from .auth import SESSION_COOKIE
    sid = request.cookies.get(SESSION_COOKIE)
    if not sid:
        return None
    auth_db: AuthDB = request.app["auth_db"]
    session = auth_db.validate_session(sid)
    if not session:
        return None
    return hashlib.sha256(sid.encode()).hexdigest()


async def handle_ws(request: web.Request) -> web.WebSocketResponse:
    app = request.app
    cfg: Config = app["cfg"]
    hub: Hub = app["hub"]
    bridge: Bridge = app["bridge"]
    session_mgr: SessionWsManager = app["session_mgr"]

    # Validate Origin header
    if not _validate_ws_origin(request, cfg.origins):
        raise web.HTTPForbidden(text="Origin not allowed")

    # Validate session
    sid_hash = _ws_session(request)
    if not sid_hash:
        raise web.HTTPUnauthorized(text="Valid session required for WS")

    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    hub.add(ws)
    session_mgr.track(sid_hash, ws)
    LOG.info("WS join (%d clients, session=%s…)", hub.count, sid_hash[:12])

    def send(obj: dict) -> "asyncio.Future":
        return ws.send_str(json.dumps(obj, separators=(",", ":")))

    # 1) history, 2) recent alerts replayed with stored ack, 3) broker state
    await send(envelope("history", {"points": await db.read_history(cfg.evidence_db)}))
    for alert in reversed(await db.read_recent_alerts(cfg.evidence_db)):
        await send(envelope("alert", alert))
    await send(envelope("toast", {"msg": "MQTT LIVE" if bridge.connected else "MQTT DEGRADED",
                                  "sev": "green" if bridge.connected else "red"}))

    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                if msg.type == WSMsgType.ERROR:
                    LOG.warning("WS error: %s", ws.exception())
                continue
            try:
                ctrl = json.loads(msg.data)
            except ValueError:
                continue
            if not isinstance(ctrl, dict):
                continue
            # clock-sync control frame (never touches MQTT)
            if clock.is_ctl(ctrl):
                pong = clock.make_pong(ctrl)
                if pong is not None:
                    await send(pong)
                continue
            # operator ACK — authenticated sockets only (validated at upgrade)
            aid = ctrl.get("ack")
            if aid:
                ok = await bridge.publish_ack(str(aid))
                await send(envelope("toast", {
                    "msg": f"ACK {'sent' if ok else 'queued'}: {aid}",
                    "sev": "green" if ok else "yellow"}))
                continue
            # SIM TOUR trigger — relayed to voidmain/sim/* so the dev feed runs
            # the tour on the bus: dashboard + ESP32 panel move together.
            sim = ctrl.get("sim")
            if sim:
                action = str(sim)
                ok = await bridge.publish_sim(action)
                await send(envelope("toast", {
                    "msg": (f"SIM TOUR {'started' if action == 'start' else 'stopped'} on the bus"
                            if ok else f"SIM trigger {action} — MQTT bridge offline"),
                    "sev": "green" if ok else "yellow"}))
    finally:
        session_mgr.untrack(sid_hash, ws)
        hub.remove(ws)
        LOG.info("WS leave (%d clients)", hub.count)
    return ws


# --------------------------------------------------------------------------- #
# App wiring
# --------------------------------------------------------------------------- #
async def _on_startup(app: web.Application) -> None:
    app["bridge_task"] = asyncio.create_task(app["bridge"].run())
    cfg: Config = app["cfg"]
    if cfg.ai_enabled and cfg.ai_warm:
        # load the local model now so the first demo question is ~2s, not ~45s
        asyncio.get_running_loop().run_in_executor(
            None, rag.warm_up, cfg.ollama_url, cfg.ai_model)
    # give the console a correct status dot early — cheap, no model time
    asyncio.get_running_loop().run_in_executor(None, rag.list_models, cfg.ollama_url)


async def _on_cleanup(app: web.Application) -> None:
    app["bridge"].stop()
    task = app.get("bridge_task")
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    auth_db = app.get("auth_db")
    if auth_db:
        auth_db.close()


def create_app(cfg: Config | None = None) -> web.Application:
    cfg = cfg or load()
    app = web.Application()
    app["cfg"] = cfg
    app["hub"] = Hub()
    app["bridge"] = Bridge(cfg, app["hub"])

    auth_db = AuthDB(cfg.auth_db)
    app["auth_db"] = auth_db
    app["auth_rp_id"] = cfg.rp_id
    app["auth_rp_name"] = cfg.rp_name
    app["auth_origins"] = cfg.origins
    app["auth_secure_cookies"] = cfg.tls_enabled
    app["demo_code"] = cfg.demo_code
    app["google_client_id"] = cfg.google_client_id
    app["owner_emails"] = cfg.owner_emails
    session_mgr = SessionWsManager()
    app["session_mgr"] = session_mgr

    add_auth_routes(app)

    app["csp_app"] = csp.csp_app(tls=cfg.tls_enabled, rp_id=cfg.rp_id, https_port=cfg.https_port)

    if cfg.debug_html.exists():
        html = cfg.debug_html.read_text(encoding="utf-8")
        app["debug_page"] = (
            html,
            csp.build_csp_for_html(html, tls=cfg.tls_enabled, rp_id=cfg.rp_id, https_port=cfg.https_port),
        )
        LOG.info("debug.html loaded from %s", cfg.debug_html)
    else:
        app["debug_page"] = None

    LOG.info("dist=%s (exists=%s) version=%s tls=%s",
             cfg.dist_dir, cfg.dist_dir.exists(), cfg.version, cfg.tls_enabled)

    # phone-friendly alert feed page
    if cfg.alerts_html.exists():
        alerts_html = cfg.alerts_html.read_text(encoding="utf-8")
        app["alerts_page"] = (
            alerts_html,
            csp.build_csp_for_html(alerts_html, tls=cfg.tls_enabled, rp_id=cfg.rp_id, https_port=cfg.https_port),
        )
        LOG.info("alerts.html loaded from %s", cfg.alerts_html)
    else:
        app["alerts_page"] = None

    app.add_routes([
        web.get("/ws", handle_ws),
        web.get("/healthz", handle_healthz),
        web.get("/alerts", handle_alerts_page),
        web.get("/alerts.json", handle_alerts),
        web.get("/debug.html", handle_debug),
        web.get("/debug/triggers", handle_debug_triggers),
        web.post("/debug/trigger", handle_debug_trigger),
        web.post("/ai/ask", handle_ai_ask),
        web.get("/ai/models", handle_ai_models),
        web.get("/favicon.ico", handle_favicon),
        web.get("/assets/{tail:.*}", handle_asset),
        web.get("/", handle_index),
        web.get("/{tail:.*}", handle_spa),
    ])
    app.on_startup.append(_on_startup)
    app.on_cleanup.append(_on_cleanup)
    return app


def _make_redirect_app(https_origin: str) -> web.Application:
    """Tiny app that 301-redirects every request to the HTTPS origin."""
    async def redirect(request: web.Request) -> web.Response:
        target = f"{https_origin}{request.path_qs}"
        raise web.HTTPMovedPermanently(target)

    app = web.Application()
    app.router.add_route("*", "/{path:.*}", redirect)
    return app


async def _run_tls(cfg: Config) -> None:
    """Start both the HTTPS app and the HTTP redirect."""
    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_ctx.load_cert_chain(str(cfg.tls_cert), str(cfg.tls_key))
    ssl_ctx.minimum_version = ssl.TLSVersion.TLSv1_2

    app = create_app(cfg)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, cfg.http_host, cfg.https_port, ssl_context=ssl_ctx)
    await site.start()
    LOG.info("HTTPS listening on %s:%d", cfg.http_host, cfg.https_port)

    if cfg.redirect_http:
        port_suffix = f":{cfg.https_port}" if cfg.https_port != 443 else ""
        https_origin = f"https://{cfg.rp_id}{port_suffix}"
        redir_app = _make_redirect_app(https_origin)
        redir_runner = web.AppRunner(redir_app)
        await redir_runner.setup()
        redir_site = web.TCPSite(redir_runner, cfg.http_host, cfg.http_port)
        await redir_site.start()
        LOG.info("HTTP redirect on :%d → %s", cfg.http_port, https_origin)

    try:
        await asyncio.Event().wait()
    finally:
        await runner.cleanup()


def main() -> None:
    logging.basicConfig(level=os.environ.get("VOIDMAIN_LOG", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if os.name == "nt":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    cfg = load()
    if cfg.tls_enabled:
        asyncio.run(_run_tls(cfg))
    else:
        web.run_app(create_app(cfg), host=cfg.http_host, port=cfg.http_port, print=None)


if __name__ == "__main__":
    main()

"""Content-Security-Policy headers.

Two policies:
  * APP  — for the built React app: strict, everything from 'self', no inline.
  * debug.html — same strictness but its ONE inline <script> and <style> are
    sha256-pinned (the debug page is standalone and must keep working even if
    the app build is broken, so it cannot use hashed-filename external files).
"""

from __future__ import annotations

import base64
import hashlib
import re

from aiohttp import web

def csp_app(*, tls: bool = False, rp_id: str = "localhost", https_port: int = 443) -> str:
    if tls:
        port_suffix = f":{https_port}" if https_port != 443 else ""
        ws_src = f"wss://{rp_id}{port_suffix}"
    else:
        ws_src = "ws: wss:"
    return (
        f"default-src 'self'; script-src 'self'; style-src 'self'; "
        f"connect-src 'self' {ws_src}; img-src 'self' data:; "
        f"base-uri 'self'; frame-ancestors 'none'"
    )


CSP_APP = csp_app()

_STYLE_RE = re.compile(r"<style[^>]*>(.*?)</style>", re.DOTALL)
_SCRIPT_RE = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.DOTALL)


def sha256_b64(text: str) -> str:
    return "sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode("ascii")


def build_csp_for_html(
    html: str, *, tls: bool = False, rp_id: str = "localhost", https_port: int = 443,
) -> str:
    """CSP for a standalone HTML page, hashing its inline blocks."""
    scripts = _SCRIPT_RE.findall(html)
    styles = _STYLE_RE.findall(html)
    script_src = " ".join(f"'{sha256_b64(s)}'" for s in scripts) or "'none'"
    style_src = " ".join(f"'{sha256_b64(s)}'" for s in styles) or "'none'"
    if tls:
        port_suffix = f":{https_port}" if https_port != 443 else ""
        ws_src = f"wss://{rp_id}{port_suffix}"
    else:
        ws_src = "ws: wss:"
    return (
        f"default-src 'self'; script-src {script_src}; style-src {style_src}; "
        f"connect-src 'self' {ws_src}; img-src 'self' data:; "
        f"base-uri 'self'; frame-ancestors 'none'"
    )


def apply(resp: web.StreamResponse, csp: str) -> web.StreamResponse:
    resp.headers["Content-Security-Policy"] = csp
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp

"""ULTRON dashboard server configuration (env-driven).

Owning node: Pi4 — GOVERNANCE. No secrets in code; everything via env, with
dev-safe defaults so the same tree runs on a laptop and on the Pi4.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

VERSION = "0.5.0-phase1"

# server/ -> dashboard/ ; built app lives at dashboard/dist (deploy) or web/dist (dev).
_SERVER_DIR = Path(__file__).resolve().parent
_DASHBOARD_DIR = _SERVER_DIR.parent


def _default_dist() -> Path:
    env = os.environ.get("ULTRON_DIST")
    if env:
        return Path(env)
    for cand in (_DASHBOARD_DIR / "dist", _DASHBOARD_DIR / "web" / "dist"):
        if cand.exists():
            return cand
    return _DASHBOARD_DIR / "dist"


def _default_debug_html() -> Path:
    for cand in (_DASHBOARD_DIR / "debug.html", _DASHBOARD_DIR / "debug" / "debug.html"):
        if cand.exists():
            return cand
    return _DASHBOARD_DIR / "debug" / "debug.html"


def _b(name: str, default: bool = False) -> bool:
    return os.environ.get(name, "1" if default else "0").lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Config:
    http_host: str = os.environ.get("ULTRON_HTTP_HOST", "0.0.0.0")
    http_port: int = int(os.environ.get("ULTRON_HTTP_PORT", "8080"))

    mqtt_host: str = os.environ.get("ULTRON_MQTT_HOST", "127.0.0.1")
    mqtt_port: int = int(os.environ.get("ULTRON_MQTT_PORT", "1883"))
    mqtt_user: str = os.environ.get("ULTRON_MQTT_USER", "dash")
    mqtt_pass: str = os.environ.get("ULTRON_MQTT_PASS", "")

    evidence_db: Path = Path(os.environ.get("ULTRON_EVIDENCE_DB", "/mnt/pendrive/ultron/ultron.db"))
    dist_dir: Path = field(default_factory=_default_dist)
    debug_html: Path = field(default_factory=_default_debug_html)

    # /debug.html gating: enabled globally, or only from the mgmt subnet with basic auth.
    debug_enabled: bool = _b("ULTRON_DEBUG", False)
    mgmt_subnet: str = os.environ.get("ULTRON_MGMT_SUBNET", "192.168.50.0/24")
    debug_user: str = os.environ.get("ULTRON_DEBUG_USER", "admin")
    debug_pass: str = os.environ.get("ULTRON_DEBUG_PASS", "")

    # TLS (CP6)
    tls_cert: Path | None = field(default_factory=lambda: (
        Path(p) if (p := os.environ.get("ULTRON_TLS_CERT")) else None
    ))
    tls_key: Path | None = field(default_factory=lambda: (
        Path(p) if (p := os.environ.get("ULTRON_TLS_KEY")) else None
    ))
    https_port: int = int(os.environ.get("ULTRON_HTTPS_PORT", "443"))
    redirect_http: bool = _b("ULTRON_REDIRECT_HTTP", True)

    # Auth (CP4)
    auth_db: Path = Path(os.environ.get("ULTRON_AUTH_DB",
                                         str(_DASHBOARD_DIR / "auth.db")))
    rp_id: str = os.environ.get("ULTRON_RP_ID", "localhost")
    rp_name: str = os.environ.get("ULTRON_RP_NAME", "ULTRON")
    origins: list[str] = field(default_factory=lambda: [
        o.strip() for o in os.environ.get(
            "ULTRON_ORIGINS", "http://localhost:8080"
        ).split(",") if o.strip()
    ])
    session_ttl: int = int(os.environ.get("ULTRON_SESSION_TTL", "3600"))

    version: str = VERSION

    @property
    def tls_enabled(self) -> bool:
        return self.tls_cert is not None and self.tls_key is not None

    @property
    def dist_index(self) -> Path:
        return self.dist_dir / "index.html"


class ConfigError(SystemExit):
    def __init__(self, msg: str) -> None:
        super().__init__(f"CONFIG ERROR: {msg}")


def _validate(cfg: "Config") -> None:
    import ipaddress as _ip
    import urllib.parse as _url

    for origin in cfg.origins:
        parsed = _url.urlparse(origin)
        if parsed.scheme == "http" and parsed.hostname not in (
            "localhost", "127.0.0.1", "::1",
        ):
            raise ConfigError(
                f"ULTRON_ORIGINS contains non-localhost http:// origin: {origin}"
            )

    if cfg.debug_enabled:
        if cfg.rp_id not in ("localhost", "127.0.0.1", "::1"):
            raise ConfigError(
                f"ULTRON_DEBUG=1 with non-localhost RP ID '{cfg.rp_id}' is unsafe"
            )

    try:
        _ip.ip_address(cfg.rp_id)
        raise ConfigError(
            f"ULTRON_RP_ID must be a hostname, not an IP address: {cfg.rp_id}"
        )
    except ValueError:
        pass  # not an IP — that's correct

    if cfg.tls_cert or cfg.tls_key:
        if not (cfg.tls_cert and cfg.tls_key):
            raise ConfigError(
                "Both ULTRON_TLS_CERT and ULTRON_TLS_KEY must be set together"
            )
        if not cfg.tls_cert.exists():
            raise ConfigError(f"TLS cert not found: {cfg.tls_cert}")
        if not cfg.tls_key.exists():
            raise ConfigError(f"TLS key not found: {cfg.tls_key}")


def load() -> "Config":
    cfg = Config()
    _validate(cfg)
    return cfg

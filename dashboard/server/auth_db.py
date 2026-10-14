"""ULTRON auth database (auth.db — separate from evidence.db).

Schema: credentials, sessions, challenges, enrollment_tokens, auth_audit.
No biometric fields anywhere. Session IDs stored as SHA-256 hashes only.
Enrollment tokens stored as SHA-256 hashes only.
"""

from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


def _sha256(val: str) -> str:
    return hashlib.sha256(val.encode()).hexdigest()


# ── Schema ────────────────────────────────────────────────────────────────── #

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS credentials (
    id              TEXT PRIMARY KEY,   -- credential ID (base64url)
    public_key      BLOB NOT NULL,      -- CBOR-encoded public key from py_webauthn
    sign_count      INTEGER NOT NULL DEFAULT 0,
    transports      TEXT,               -- JSON list of transports
    created_at      REAL NOT NULL,
    last_used_at    REAL,
    revoked         INTEGER NOT NULL DEFAULT 0,
    device_type     TEXT,               -- single_device / multi_device
    backed_up       INTEGER NOT NULL DEFAULT 0,
    aaguid          TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    id_hash         TEXT PRIMARY KEY,   -- SHA-256 of the actual session ID
    created_at      REAL NOT NULL,
    expires_at      REAL NOT NULL,
    credential_id   TEXT NOT NULL,
    ip              TEXT,
    revoked         INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (credential_id) REFERENCES credentials(id)
);

CREATE TABLE IF NOT EXISTS challenges (
    ceremony_id     TEXT PRIMARY KEY,   -- cookie value binding this ceremony
    challenge       TEXT NOT NULL,      -- base64url challenge
    type            TEXT NOT NULL,      -- 'registration' or 'authentication'
    created_at      REAL NOT NULL,
    expires_at      REAL NOT NULL,
    consumed        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS enrollment_tokens (
    token_hash      TEXT PRIMARY KEY,   -- SHA-256 of the plaintext token
    created_at      REAL NOT NULL,
    expires_at      REAL NOT NULL,
    consumed        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auth_audit (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              REAL NOT NULL,
    event           TEXT NOT NULL,
    ip              TEXT,
    credential_id   TEXT,
    detail          TEXT
);
"""


# ── Data classes ──────────────────────────────────────────────────────────── #

@dataclass
class Credential:
    id: str
    public_key: bytes
    sign_count: int
    transports: str | None
    created_at: float
    last_used_at: float | None
    revoked: bool
    device_type: str | None
    backed_up: bool
    aaguid: str | None


@dataclass
class Session:
    id_hash: str
    created_at: float
    expires_at: float
    credential_id: str
    ip: str | None
    revoked: bool


# ── Database class ────────────────────────────────────────────────────────── #

class AuthDB:
    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn: sqlite3.Connection | None = None

    def _db(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.executescript(_SCHEMA)
        return self._conn

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None

    # ── Credentials ───────────────────────────────────────────────────── #

    def save_credential(
        self, cred_id: str, public_key: bytes, sign_count: int,
        transports: str | None = None, device_type: str | None = None,
        backed_up: bool = False, aaguid: str | None = None,
    ) -> None:
        self._db().execute(
            "INSERT INTO credentials (id, public_key, sign_count, transports, "
            "created_at, device_type, backed_up, aaguid) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (cred_id, public_key, sign_count, transports,
             time.time(), device_type, int(backed_up), aaguid),
        )
        self._db().commit()

    def get_credential(self, cred_id: str) -> Credential | None:
        row = self._db().execute(
            "SELECT id, public_key, sign_count, transports, created_at, "
            "last_used_at, revoked, device_type, backed_up, aaguid "
            "FROM credentials WHERE id = ?", (cred_id,)
        ).fetchone()
        if not row:
            return None
        return Credential(
            id=row[0], public_key=row[1], sign_count=row[2],
            transports=row[3], created_at=row[4], last_used_at=row[5],
            revoked=bool(row[6]), device_type=row[7],
            backed_up=bool(row[8]), aaguid=row[9],
        )

    def get_credential_non_revoked(self, cred_id: str) -> Credential | None:
        cred = self.get_credential(cred_id)
        if cred and not cred.revoked:
            return cred
        return None

    def list_credentials(self) -> list[Credential]:
        rows = self._db().execute(
            "SELECT id, public_key, sign_count, transports, created_at, "
            "last_used_at, revoked, device_type, backed_up, aaguid "
            "FROM credentials ORDER BY created_at"
        ).fetchall()
        return [
            Credential(r[0], r[1], r[2], r[3], r[4], r[5],
                        bool(r[6]), r[7], bool(r[8]), r[9])
            for r in rows
        ]

    def count_non_revoked(self) -> int:
        row = self._db().execute(
            "SELECT COUNT(*) FROM credentials WHERE revoked = 0"
        ).fetchone()
        return row[0] if row else 0

    def update_sign_count(self, cred_id: str, new_count: int) -> None:
        self._db().execute(
            "UPDATE credentials SET sign_count = ?, last_used_at = ? WHERE id = ?",
            (new_count, time.time(), cred_id),
        )
        self._db().commit()

    def revoke_credential(self, cred_id: str) -> bool:
        cur = self._db().execute(
            "UPDATE credentials SET revoked = 1 WHERE id = ? AND revoked = 0",
            (cred_id,),
        )
        self._db().commit()
        return cur.rowcount > 0

    # ── Sessions ──────────────────────────────────────────────────────── #

    def create_session(
        self, credential_id: str, ip: str | None = None,
        ttl: int = 3600,
    ) -> str:
        sid = secrets.token_urlsafe(32)
        sid_hash = _sha256(sid)
        now = time.time()
        self._db().execute(
            "INSERT INTO sessions (id_hash, created_at, expires_at, credential_id, ip) "
            "VALUES (?, ?, ?, ?, ?)",
            (sid_hash, now, now + ttl, credential_id, ip),
        )
        self._db().commit()
        return sid

    def validate_session(self, sid: str) -> Session | None:
        sid_hash = _sha256(sid)
        row = self._db().execute(
            "SELECT id_hash, created_at, expires_at, credential_id, ip, revoked "
            "FROM sessions WHERE id_hash = ?", (sid_hash,)
        ).fetchone()
        if not row:
            return None
        s = Session(row[0], row[1], row[2], row[3], row[4], bool(row[5]))
        if s.revoked or s.expires_at < time.time():
            return None
        return s

    def revoke_session(self, sid: str) -> bool:
        sid_hash = _sha256(sid)
        cur = self._db().execute(
            "UPDATE sessions SET revoked = 1 WHERE id_hash = ?", (sid_hash,),
        )
        self._db().commit()
        return cur.rowcount > 0

    def revoke_session_by_hash(self, sid_hash: str) -> bool:
        cur = self._db().execute(
            "UPDATE sessions SET revoked = 1 WHERE id_hash = ?", (sid_hash,),
        )
        self._db().commit()
        return cur.rowcount > 0

    def revoke_all_sessions(self) -> int:
        cur = self._db().execute(
            "UPDATE sessions SET revoked = 1 WHERE revoked = 0",
        )
        self._db().commit()
        return cur.rowcount

    # ── Challenges ────────────────────────────────────────────────────── #

    def store_challenge(
        self, ceremony_id: str, challenge: str,
        ceremony_type: str, ttl: int = 180,
    ) -> None:
        now = time.time()
        self._db().execute(
            "INSERT OR REPLACE INTO challenges "
            "(ceremony_id, challenge, type, created_at, expires_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (ceremony_id, challenge, ceremony_type, now, now + ttl),
        )
        self._db().commit()

    def consume_challenge(self, ceremony_id: str) -> Optional[str]:
        row = self._db().execute(
            "SELECT challenge, expires_at, consumed FROM challenges "
            "WHERE ceremony_id = ?", (ceremony_id,)
        ).fetchone()
        if not row:
            return None
        challenge, expires_at, consumed = row
        if consumed or expires_at < time.time():
            return None
        self._db().execute(
            "UPDATE challenges SET consumed = 1 WHERE ceremony_id = ?",
            (ceremony_id,),
        )
        self._db().commit()
        return challenge

    # ── Enrollment tokens ─────────────────────────────────────────────── #

    def create_enrollment_token(self, ttl: int = 600) -> str:
        token = secrets.token_urlsafe(32)
        token_hash = _sha256(token)
        now = time.time()
        self._db().execute(
            "INSERT INTO enrollment_tokens (token_hash, created_at, expires_at) "
            "VALUES (?, ?, ?)",
            (token_hash, now, now + ttl),
        )
        self._db().commit()
        return token

    def consume_enrollment_token(self, token: str) -> bool:
        token_hash = _sha256(token)
        row = self._db().execute(
            "SELECT expires_at, consumed FROM enrollment_tokens "
            "WHERE token_hash = ?", (token_hash,)
        ).fetchone()
        if not row:
            return False
        expires_at, consumed = row
        if consumed or expires_at < time.time():
            return False
        self._db().execute(
            "UPDATE enrollment_tokens SET consumed = 1 WHERE token_hash = ?",
            (token_hash,),
        )
        self._db().commit()
        return True

    # ── Audit ─────────────────────────────────────────────────────────── #

    def audit(
        self, event: str, ip: str | None = None,
        credential_id: str | None = None, detail: str | None = None,
    ) -> None:
        self._db().execute(
            "INSERT INTO auth_audit (ts, event, ip, credential_id, detail) "
            "VALUES (?, ?, ?, ?, ?)",
            (time.time(), event, ip, credential_id, detail),
        )
        self._db().commit()

    def read_audit(self, limit: int = 100) -> list[dict]:
        rows = self._db().execute(
            "SELECT id, ts, event, ip, credential_id, detail "
            "FROM auth_audit ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [
            {"id": r[0], "ts": r[1], "event": r[2], "ip": r[3],
             "credential_id": r[4], "detail": r[5]}
            for r in rows
        ]

    # ── Owner check ───────────────────────────────────────────────────── #

    def has_owner(self) -> bool:
        return self.count_non_revoked() > 0

    def reset_owner(self) -> None:
        self._db().execute("UPDATE credentials SET revoked = 1")
        self._db().execute("UPDATE sessions SET revoked = 1")
        self._db().commit()
        self.audit("reset_owner")

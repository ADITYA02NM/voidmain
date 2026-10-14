"""ULTRON auth CLI commands.

Usage:
  python -m dashboard.server.auth_cli enroll-token [--ttl SECONDS]
  python -m dashboard.server.auth_cli list-credentials
  python -m dashboard.server.auth_cli revoke CREDENTIAL_ID
  python -m dashboard.server.auth_cli reset-owner
  python -m dashboard.server.auth_cli audit [--limit N]
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone

from .auth_db import AuthDB
from .config import load


def _ts(epoch: float | None) -> str:
    if epoch is None:
        return "—"
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def cmd_enroll_token(db: AuthDB, args: argparse.Namespace) -> None:
    cfg = load()
    token = db.create_enrollment_token(ttl=args.ttl)
    origin = cfg.origins[0] if cfg.origins else f"http://localhost:{cfg.http_port}"
    url = f"{origin}/?t={token}"
    print(f"\n  Enrollment token (single-use, expires in {args.ttl}s):\n")
    print(f"    {token}\n")
    print(f"  Open this link in your browser to register:\n")
    print(f"    {url}\n")
    print("  This token will NOT be shown again.\n")


def cmd_list_credentials(db: AuthDB, _args: argparse.Namespace) -> None:
    creds = db.list_credentials()
    if not creds:
        print("No credentials registered.")
        return
    print(f"{'ID':<44} {'Created':<20} {'Last Used':<20} {'Count':>6} {'Status'}")
    print("─" * 110)
    for c in creds:
        status = "REVOKED" if c.revoked else "active"
        print(f"{c.id:<44} {_ts(c.created_at):<20} {_ts(c.last_used_at):<20} {c.sign_count:>6} {status}")


def cmd_revoke(db: AuthDB, args: argparse.Namespace) -> None:
    cred = db.get_credential(args.credential_id)
    if not cred:
        print(f"Credential not found: {args.credential_id}", file=sys.stderr)
        sys.exit(1)
    if cred.revoked:
        print("Credential already revoked.", file=sys.stderr)
        sys.exit(1)

    non_revoked = db.count_non_revoked()
    if non_revoked <= 1:
        print("Cannot revoke the last credential. Use reset-owner instead.", file=sys.stderr)
        sys.exit(1)

    db.revoke_credential(args.credential_id)
    db.audit("cli_revoke", credential_id=args.credential_id)
    print(f"Revoked: {args.credential_id}")


def cmd_reset_owner(db: AuthDB, _args: argparse.Namespace) -> None:
    creds = db.list_credentials()
    active = [c for c in creds if not c.revoked]
    if not active:
        print("No active credentials to reset.")
        return

    print(f"\n  WARNING: This will revoke ALL {len(active)} credential(s)")
    print("  and invalidate ALL sessions. The owner must re-enroll.\n")
    confirm = input("  Type 'RESET OWNER' to confirm: ")
    if confirm.strip() != "RESET OWNER":
        print("Aborted.")
        sys.exit(1)

    db.reset_owner()
    print("Owner reset complete. Generate a new enrollment token to re-enroll.")


def cmd_audit(db: AuthDB, args: argparse.Namespace) -> None:
    rows = db.read_audit(limit=args.limit)
    if not rows:
        print("No audit entries.")
        return
    print(f"{'ID':>6} {'Timestamp':<20} {'Event':<28} {'IP':<16} {'Credential':<24} Detail")
    print("─" * 120)
    for r in rows:
        print(f"{r['id']:>6} {_ts(r['ts']):<20} {r['event']:<28} "
              f"{(r['ip'] or ''):.<16} {(r['credential_id'] or ''):<24} "
              f"{r['detail'] or ''}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="ultron-auth", description="ULTRON auth management")
    parser.add_argument("--db", help="Path to auth.db (default: from config)")
    sub = parser.add_subparsers(dest="command")

    p_enroll = sub.add_parser("enroll-token", help="Generate a single-use enrollment token")
    p_enroll.add_argument("--ttl", type=int, default=600, help="Token lifetime in seconds (default: 600)")

    sub.add_parser("list-credentials", help="List all credentials")

    p_revoke = sub.add_parser("revoke", help="Revoke a credential")
    p_revoke.add_argument("credential_id", help="Credential ID to revoke")

    sub.add_parser("reset-owner", help="Revoke ALL credentials and sessions")

    p_audit = sub.add_parser("audit", help="Show auth audit log")
    p_audit.add_argument("--limit", type=int, default=50, help="Max entries (default: 50)")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    cfg = load()
    db_path = args.db or cfg.auth_db
    db = AuthDB(db_path)

    commands = {
        "enroll-token": cmd_enroll_token,
        "list-credentials": cmd_list_credentials,
        "revoke": cmd_revoke,
        "reset-owner": cmd_reset_owner,
        "audit": cmd_audit,
    }
    try:
        commands[args.command](db, args)
    finally:
        db.close()


if __name__ == "__main__":
    main()

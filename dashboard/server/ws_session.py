"""Per-session WebSocket tracker.

Every open WebSocket is bound to a session hash. On logout/revocation/expiry
all sockets for that session close within 1 s.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict

from aiohttp import web

LOG = logging.getLogger("ultron.ws_session")


class SessionWsManager:
    def __init__(self) -> None:
        self._ws_by_session: dict[str, set[web.WebSocketResponse]] = defaultdict(set)

    def track(self, sid_hash: str, ws: web.WebSocketResponse) -> None:
        self._ws_by_session[sid_hash].add(ws)

    def untrack(self, sid_hash: str, ws: web.WebSocketResponse) -> None:
        sockets = self._ws_by_session.get(sid_hash)
        if sockets:
            sockets.discard(ws)
            if not sockets:
                del self._ws_by_session[sid_hash]

    async def close_session_sockets(self, sid_hash: str) -> int:
        sockets = self._ws_by_session.pop(sid_hash, set())
        if not sockets:
            return 0
        count = len(sockets)
        LOG.info("closing %d WS for session %s…", count, sid_hash[:12])

        async def _close(ws: web.WebSocketResponse) -> None:
            try:
                await asyncio.wait_for(
                    ws.close(code=4401, message=b"session ended"),
                    timeout=1.0,
                )
            except Exception:  # noqa: BLE001
                pass

        await asyncio.gather(*[_close(ws) for ws in sockets])
        return count

    @property
    def count(self) -> int:
        return sum(len(s) for s in self._ws_by_session.values())

"""Console assistant: local RAG over this repo's docs + the live dashboard state.

Zero cloud, on purpose: retrieval is a small in-process BM25 index over the
project's own documents, and generation is a local Ollama model
(VOIDMAIN_OLLAMA_URL, default qwen3:8b with thinking off so answers land in a
couple of seconds on stage).

If the model is unreachable, slow, or answers nothing, `ask()` degrades to a
retrieval-only reply labelled mode="retrieval" — the console never invents an
answer it cannot ground in the docs.
"""

from __future__ import annotations

import json
import logging
import math
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

LOG = logging.getLogger("voidmain.rag")

_DASHBOARD = Path(__file__).resolve().parent.parent          # …/dashboard
_ROOT = _DASHBOARD.parent                                    # repo root

# label -> file. Kept small and factual on purpose: this is the operator's
# manual, not the whole internet.
CORPUS: tuple[tuple[str, Path], ...] = (
    ("README", _ROOT / "README.md"),
    ("DEMO", _ROOT / "docs" / "DEMO.md"),
    ("PRODUCT", _ROOT / "docs" / "PRODUCT-BRIEF.md"),
    ("ESP32", _ROOT / "firmware" / "esp32-risk-mini" / "README.md"),
    ("TRIGGERS", _DASHBOARD / "server" / "triggers.py"),
    ("CONFIG", _DASHBOARD / "server" / "config.py"),
    ("CONTRACT", _DASHBOARD / "web" / "src" / "contracts" / "ws.ts"),
)

STOP = frozenset(
    "a an the and or of to in for on with is are be by as at it this that from "
    "we you i my your our can could should would do does did not no yes if then "
    "when what which who how why all any some more most other into over under "
    "been being am has have had also just than too very".split()
)
_TOKEN = re.compile(r"[a-z0-9]+")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$")
MAX_CHUNK = 1400


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in STOP]


@dataclass
class Chunk:
    source: str
    title: str
    text: str
    tf: dict[str, int] = field(default_factory=dict)
    length: int = 1


def _chunk_file(label: str, path: Path) -> list[Chunk]:
    """Paragraph chunks that carry their nearest heading as the title."""
    if not path.is_file():
        return []
    out: list[Chunk] = []
    title = path.name
    buf: list[str] = []

    def flush() -> None:
        if not buf:
            return
        text = "\n".join(buf).strip()
        buf.clear()
        while text:
            part, text = text[:MAX_CHUNK], text[MAX_CHUNK:]
            if len(part) < 40 and out:          # don't emit debris tails
                if out[-1].source == label and len(out[-1].text) < MAX_CHUNK * 2:
                    out[-1].text += "\n" + part
                    continue
            toks = _tokens(part)
            counts: dict[str, int] = {}
            for t in toks:
                counts[t] = counts.get(t, 0) + 1
            out.append(Chunk(label, title, part, counts, max(1, len(toks))))

    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = _HEADING.match(line)
        if m:
            flush()
            title = f"{path.name} › {m.group(1)}"
            buf.append(line)
            continue
        if not line.strip():
            flush()
            continue
        buf.append(line)
    flush()
    return out


# ── Predicates the console needs to answer soundly ──────────────────────────── #

# These are small, factual helpers derived from the same config + triggers.py
# catalogues the dashboard already renders. They give the model a grounded
# vocabulary for bands, nodes, commands, tours, alerts, devices, edge events,
# the ESP32 panel and the demo so it does not invent IP addresses, codes,
# thresholds or button names.

CONTEXT_PREDICATES = object()  # replaced below after classes are defined


class CONTEXT_PREDICATES_Class:
    """Plain-language predicate helpers for the console assistant."""

    def band_description(self, b: str) -> str:
        """Plain-language posture description per band."""
        if b == "GREEN":
            return ("GREEN = normal posture. Score 0–29. Devices nominal, sensors clear, "
                    "no outstanding alerts. No automation action taken.")
        if b == "YELLOW":
            return ("YELLOW = elevated posture. Score 30–59. Unusual activity flagged "
                    "(for example motion after hours or a moisture reading above baseline). "
                    "Reviewers should investigate; no owner alert is sent yet.")
        if b == "RED":
            return ("RED = alert posture. Score 60–84. An intrusion or threshold event is "
                    "active — for example a door opened unexpectedly with camera person "
                    "detection. An alert has been sent to the owner and the device state is "
                    "red until the situation is contained.")
        if b == "PURPLE":
            return ("PURPLE = action taken. Score 85–100. The automation playbook fired: "
                    "doors locked, lights turned on, cameras switched to high-res recording "
                    "and the garage secured. The system has moved from detection to a "
                    "contained action state.")
        return f"{b} is not a valid VoidMain band. The four bands are GREEN, YELLOW, RED and PURPLE."

    def nodes_description(self) -> str:
        return ("Nodes: pi4 (core / governance, MQTT + dashboard + risk engine), "
                "pi3a (sensors / detection, aggregator), pi3b (alerting / reporting). "
                "esp32 (ESP32-C3 OLED + LED indicator) is real edge hardware, not a simulated node.")

    def score_decode(self, s: int) -> str:
        if not isinstance(s, int) or not 0 <= s <= 100:
            return "A VoidMain risk score is an integer 0–100. 0 is safest, 100 is most severe."
        b = self._band_for_score(s)
        if s <= 29:
            return (f"Score {s} is {b}. The band names are literal posture labels: GREEN means "
                    "the device and sensor fleet is nominal; nothing needs action.")
        if s <= 59:
            return (f"Score {s} is {b}. At this level the system has picked up something unusual "
                    "worth a human look — motion after hours, a moisture sensor trending up, "
                    "a camera motion clip saved — but no owner alert yet.")
        if s <= 84:
            return (f"Score {s} is {b}. An alert is active. The kind of thing that pushes the score "
                    "here is a front-door opened unexpectedly with a camera person-detection event "
                    "at the same time.")
        return (f"Score {s} is {b}. This is automation territory: the system judged the situation "
                "severe enough to lock doors, switch cameras to high-res and close the garage.")

    @staticmethod
    def _band_for_score(s: int) -> str:
        from .triggers import band_for_score as _bfs
        return _bfs(s)

    def commands_description(self) -> str:
        return ("Dashboard commands you can type into the command bar: /health refreshes node "
                "health, /latency measures bus-to-screen latency, /filter type:<kind> narrows "
                "the live log, /focus <node> highlights one node's timeline, /clear-filter resets "
                "the filter, /history <24h|6h|1h> changes the chart window, /band <GREEN|YELLOW|RED|PURPLE> "
                "is a read-only band reference, /help lists commands.")

    def story_description(self) -> str:
        return ("The automated SIM TOUR is a scripted scenario the operator can run from the debug "
                "console: it seeds all 17 IoT devices GREEN, then moves through YELLOW unusual activity "
                "(yard + hall motion after hours, thermostat rising, moisture under the sink), then RED "
                "(front door opened unexpectedly with camera person detection, smoke threshold exceeded), "
                "then PURPLE (the automation playbook locks doors, turns on all lights, switches cameras to "
                "high-res and closes the garage), and finally recovers back to GREEN.")

    def explanation(self, topic: str, hit: Chunk | None = None) -> str:
        """Why a live event matters, in operator terms."""
        t = (topic or "").lower()
        if "voidmain/risk/score" in t or "voidmain/risk/band" in t:
            if hit is not None:
                return (f"That is the risk engine's score/band update. In VoidMain the score is a single "
                        f"0–100 number and the band ({hit.title if hit else 'GREEN/YELLOW/RED/PURPLE'}) is "
                        f"the posture label the dashboard, the ESP32 OLED and the LED all follow.")
            return ("That is the risk engine's score/band update. Score is 0–100; band is the posture "
                    "label GREEN/YELLOW/RED/PURPLE.")
        if "voidmain/alert/" in t:
            return ("That is an operator alert published by pi3b. Alerts carry a unique id, a severity, "
                    "a title, a source, a body and an ack flag; the dashboard lets an operator acknowledge "
                    "them and republishes the alert with ack:true so every screen agrees.")
        if "voidmain/device/" in t:
            return ("That is a device state update. VoidMain keeps 17 IoT devices (locks, lights, thermostat, "
                    "garage, plugs, motion, smoke, leak, cameras, purifier, curtain) and this is one of them "
                    "transitioning to a new state — for example a door auto-locking after the automation fired.")
        if "voidmain/health/" in t:
            return ("That is a node health heartbeat. Each node publishes retained health so the dashboard can "
                    "show which nodes are up, stale or down; the ESP32 publishes its own so its tile and the "
                    "panel's own box stay honest.")
        if "voidmain/lan/" in t:
            return ("That is a LAN event — a device joining or an unknown MAC showing up on the segment. "
                    "The dashboard spots these and surfaces them as events.")
        if "voidmain/tripwire/" in t:
            return ("That is a segment tripwire opening on a node — the hardware twin shows the door/segment "
                    "lid opening and the live log picks it up as a tripwire event.")
        if "voidmain/suricata/" in t or "voidmain/wifi/" in t:
            return ("That is an IDS or WiFi anomaly passthrough event from pi3a. Suricata signatures and "
                    "rogue-AP detections arrive here and are rendered as event rows in the dashboard.")
        return f"That topic ({topic}) is on the MQTT bus but not one of the standard VoidMain event types I can explain yet."

    def edge_events(self) -> str:
        return ("Edge / IDS events in VoidMain: unknown LAN device, known LAN device joining, rogue AP, "
                "Suricata IDS alert (for example ET EXPLOIT possible shellcode download with src/dest IP and sig_id), "
                "and a segment tripwire opening on a node.")

    def demo_instructions(self) -> str:
        return ("Demo on the LAN (see DEMO.md): laptop 1 runs the stack and the dev mock feed, laptop 2 opens "
                "the operator view and signs in with the access code, laptop 3 opens the WS debug inspector and "
                "the trigger console — every trigger button there publishes voidmain/sim/<id> and the dev feed "
                "executes it, so the dashboard, the debug console and the ESP32 OLED all move together.")


class Index:
    """Tiny BM25 (k1=1.5, b=0.75) over the corpus — no third-party deps."""

    def __init__(self) -> None:
        self.chunks: list[Chunk] = []
        self.df: dict[str, int] = {}
        self.avgdl = 1.0
        self.built_at = 0.0
        self._mtimes: tuple[float, ...] = ()
        self.rebuild(force=True)

    def _signature(self) -> tuple[float, ...]:
        sig = []
        for _, path in CORPUS:
            try:
                sig.append(path.stat().st_mtime)
            except OSError:
                sig.append(0.0)
        return tuple(sig)

    def rebuild(self, force: bool = False) -> None:
        sig = self._signature()
        if not force and sig == self._mtimes:
            return
        chunks: list[Chunk] = []
        for label, path in CORPUS:
            chunks.extend(_chunk_file(label, path))
        self.chunks = chunks
        self.df = {}
        for c in chunks:
            for t in c.tf:
                self.df[t] = self.df.get(t, 0) + 1
        self.avgdl = sum(c.length for c in chunks) / max(1, len(chunks))
        self._mtimes = sig
        self.built_at = time.time()
        LOG.info("rag index: %d chunks from %d files", len(chunks), len(CORPUS))

    def search(self, query: str, k: int = 5) -> list[tuple[float, Chunk]]:
        self.rebuild()
        n = max(1, len(self.chunks))
        q_terms = _tokens(query)
        if not q_terms:
            return []
        scores: list[tuple[float, Chunk]] = []
        for c in self.chunks:
            score = 0.0
            for t in q_terms:
                f = c.tf.get(t, 0)
                if not f:
                    continue
                df = self.df.get(t, 0)
                idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
                score += idf * (f * 2.5) / (f + 1.5 * (1 - 0.7 + 0.7 * c.length / self.avgdl))
            if score > 0:
                scores.append((score, c))
        scores.sort(key=lambda s: -s[0])
        return scores[:k]


INDEX = Index()

SYSTEM_PROMPT = (
    "You are VoidMain's console assistant, embedded in an operator dashboard for "
    "a local IoT demo. Answer ONLY from the CONTEXT given. Rules:\n"
    "1. Maximum 6 short lines, plain text, no markdown fences.\n"
    "2. Cite the source label in brackets, e.g. [DEMO], [README], [ESP32].\n"    "3. If the context does not contain the answer, use the CONTEXT reference blocks "
    "above (BAND REFERENCE, SCORE DECODE, NODES, COMMANDS, SIM TOUR, ALERTS, DEVICES, "
    "EDGE & IDS, ESP32 PANEL, DEMO) to give a grounded, factual answer instead of falling "
    "back to 'Not in the local docs.'\n"
    "4. Ground answer in the current dashboard state block when present: say the actual "
    "score, band, open alerts, MQTT status and uptime when they are relevant to the question.\n"
    "5. Never invent IP addresses, codes, thresholds, button names, command names or device "
    "identifiers. If you would have to guess one, say you cannot answer from the local docs.\n"
    "6. Prefer shorter answers for on-stage use: lead with the direct answer, then add one "
    "grounded detail only if it clarifies the answer.\n"
    "7. When asked about the ESP32 panel specifically, explain that it subscribes to "
    "voidmain/risk/score, voidmain/risk/band, voidmain/health/#, voidmain/alert/# and "
    "voidmain/device/#, renders the score + band on its OLED, drives the NeoPixel from the "
    "band, and publishes its own retained voidmain/health/esp32 heartbeat every 5s.\n"
    "8. Use metric units only: temperatures in °C, times in seconds, scores as 0–100.\n"
    "9. When the question is about a specific documented trigger id (for example score, "
    "alert, device, health, lan-unknown, suricata, tripwire, start, stop), say what topic "
    "it maps to and what the bus director (tools/mock_feed.py) does when it receives it."
)


# Wire the predicate helpers into the module-level slot the builder reads.
CONTEXT_PREDICATES = CONTEXT_PREDICATES_Class()


def _format_live(live: dict[str, Any]) -> str:
    if not live:
        return ""
    bits = []
    if live.get("score") is not None:
        bits.append(f"risk score {live['score']} (band {live.get('band', '?')})")
    if live.get("mqtt") is not None:
        bits.append(f"MQTT {'LIVE' if live['mqtt'] else 'DOWN'}")
    if live.get("ws_clients") is not None:
        bits.append(f"{live['ws_clients']} dashboard client(s)")
    if live.get("uptime_s") is not None:
        bits.append(f"backend up {live['uptime_s']}s")
    alerts = live.get("open_alerts") or []
    if alerts:
        bits.append("open alerts: " + "; ".join(alerts))
    return "\n".join(f"Live dashboard state:\n- {b}" for b in bits)


def _build_prompt(query: str, hits: list[tuple[float, Chunk]], live: dict[str, Any]) -> str:
    parts = ["CONTEXT"]
    for i, (_, c) in enumerate(hits, 1):
        parts.append(f"\n[{i}] {c.source} — {c.title}\n{c.text}")
    ctx = CONTEXT_PREDICATES
    live_block = _format_live(live)
    extra: list[str] = []

    q = query.lower()
    if any(k in q for k in ("score", "band", "green", "yellow", "red", "purple", "posture", "risk level")):
        if "score" in q or "what does" in q or "mean" in q or "band" in q:
            extra.append(f"SCORE DECODE\n{ctx.score_decode(live.get('score'))}")
        extra.append(f"BAND REFERENCE\n{ctx.band_description(live.get('band', 'GREEN'))}")
    if any(k in q for k in ("node", "pi4", "pi3a", "pi3b", "esp32", "health", "heartbea")):
        extra.append(f"NODES\n{ctx.nodes_description()}")
    if any(k in q for k in ("command", "slash", "/health", "/latency", "/filter", "/focus", "/help", "type a command", "what can i")):
        extra.append(f"COMMANDS\n{ctx.commands_description()}")
    if any(k in q for k in ("tour", "scripted", "scenario", "automation playbook", "story", "sim tour", "start", "stop")):
        extra.append(f"SIM TOUR\n{ctx.story_description()}")
    if any(k in q for k in ("alert", "acknowledge", "ack", "owner", "alerts sent")):
        if live.get("open_alerts"):
            extra.append(f"OPEN ALERTS (live)\n" + "\n".join(f"- {a}" for a in live["open_alerts"]))
        extra.append("ALERTS\nAn alert is published to voidmain/alert/<id> by pi3b. It has id, sev, title, src, body and ack. "
                     "The dashboard lets an operator ACK it; the dev feed republishes the same alert with ack:true so every "
                     "screen agrees. Acknowledging does not delete the alert — it marks it handled.")
    if any(k in q for k in ("device", "lock", "light", "thermostat", "garage", "plug", "motion", "smoke", "leak", "camera", "purifier", "curtain", "17 devices", "iot")):
        extra.append("DEVICES\nVoidMain tracks 17 IoT devices: locks (front door, back door), lights (living, bedroom, porch), "
                     "thermostat, garage door, plugs (coffee, desk), motion (hall, yard), smoke (kitchen), leak (utility), "
                     "cameras (front, yard), air purifier and bedroom curtain. Each publishes voidmain/device/<id>.")
    if any(k in q for k in ("esp32", "oled", "led", "neo", "c3", "indicator", "panel")):
        extra.append(f"ESP32 PANEL\n{ctx.explanation('esp32 panel')}")
    if any(k in q for k in ("edge", "ids", "suricata", "wifi", "rogue", "tripwire", "lan device")):
        extra.append(f"EDGE & IDS\n{ctx.edge_events()}")
    if any(k in q for k in ("demo", "lan", "laptop", "run the", "how do i", "three laptop", "3 laptop")):
        extra.append(f"DEMO\n{ctx.demo_instructions()}")

    parts = ["CONTEXT"]
    if extra:
        parts.append("\n" + "\n\n".join(extra))
    for i, (_, c) in enumerate(hits, 1):
        parts.append(f"\n[{i}] {c.source} — {c.title}\n{c.text}")
    if live_block:
        parts.append("\n" + live_block)
    parts.append(f"\nQUESTION: {query}\nANSWER:")
    return "\n".join(parts)


def _call_model(prompt: str, *, ollama_url: str, model: str, timeout: float) -> str:
    body = json.dumps({
        "model": model,
        "prompt": prompt,
        "system": SYSTEM_PROMPT,
        "stream": False,
        "think": False,                       # qwen3: ~2s answers instead of ~16s
        "keep_alive": "10m",
        "options": {"num_predict": 320, "temperature": 0.2},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{ollama_url.rstrip('/')}/api/generate", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return str(data.get("response") or "").strip()


def ask(query: str, live: dict[str, Any] | None = None, *,
        ollama_url: str, model: str, timeout: float = 60.0) -> dict[str, Any]:
    """Retrieve -> (optionally) generate. Always returns a usable answer."""
    hits = INDEX.search(query, k=5)
    sources = [{"source": c.source, "title": c.title, "score": round(s, 2)}
               for s, c in hits]
    if not hits:
        return {"mode": "empty", "answer": "Not in the local docs.",
                "sources": [], "model": None}

    # 1) grounded retrieval-only answer — also the fallback for everything below
    retrieval = "\n".join(f"- [{c.source}] {c.title}" for _, c in hits[:4])

    try:
        text = _call_model(_build_prompt(query, hits, live or {}),
                           ollama_url=ollama_url, model=model, timeout=timeout)
    except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError) as exc:
        LOG.warning("model unavailable (%s) — retrieval-only answer", exc)
        return {"mode": "retrieval", "sources": sources, "model": None,
                "answer": "Model offline — closest passages in the local docs:\n" + retrieval}

    if not text:
        LOG.warning("model returned an empty answer — retrieval-only")
        return {"mode": "retrieval", "sources": sources, "model": None,
                "answer": "Model returned nothing — closest passages:\n" + retrieval}

    return {"mode": "model", "answer": text, "sources": sources, "model": model}


def warm_up(ollama_url: str, model: str) -> None:
    """Load the model once at startup so the first demo question is fast."""
    try:
        t0 = time.monotonic()
        _call_model("Reply with: ready", ollama_url=ollama_url, model=model, timeout=120.0)
        LOG.info("ollama model %s warm in %.1fs", model, time.monotonic() - t0)
    except Exception as exc:  # noqa: BLE001 — warm-up must never fail the server
        LOG.warning("ollama warm-up skipped: %s", exc)


def list_models(ollama_url: str) -> list[dict[str, str]]:
    """Return the locally available Ollama models — used by the /ai/models hint
    endpoint so dashboard operators can see which model the console will use."""
    try:
        req = urllib.request.Request(
            f"{ollama_url.rstrip('/')}/api/tags", method="GET",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        LOG.warning("ollama model list failed: %s", exc)
        return []
    return [
        {"name": m.get("name"), "size": m.get("size"), "modified": m.get("modified")}
        for m in (data.get("models") or []) if m.get("name")
    ]

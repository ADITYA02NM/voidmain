# voidmain — 7-Slide Pitch Deck Design Prompt

> **How to use:** Copy everything inside the box below and paste it into your AI
> slide designer (Gamma, ChatGPT, Beautiful.ai, Canva Magic Design, Tome, etc.).
> It contains the full content, tone, and visual direction for all 7 slides.

---

````markdown
# Presentation Design Prompt — voidmain (Farlands Innovation Mission 7)

You are a senior presentation designer creating a 7-slide hackathon pitch deck
for a technical judges' audience. Create a dark, premium, cyber-security-themed
deck. Do NOT invent facts that are not in this brief.

## Brand / visual system
- Project name: **voidmain** — the IoT evolution of ULTRON.
- Theme: dark "glass cockpit" — near-black backgrounds (#0A0A0F), violet
  primary accent (#8A2BE2), teal secondary accent (#14E0C8), white text.
- Typography: geometric sans (Schibsted Grotesk / IBM Plex Sans / Inter).
- Every slide: top-left slide number, thin violet gradient rule under the title,
  subtle grid or node-network background texture. Consistent 64px margins.
- Icons: thin-line, 2px stroke, violet/teal. No clip-art, no stock photos of
  people. Prefer abstract sensor/network/architecture visuals.
- One idea per slide. Max 6 bullets per slide. Bullet text ≤ 14 words.
- Honest engineering tone: never claim physical hardware was validated unless
  stated; clearly label simulated components.

---

## SLIDE 1 — Title / Hero
**Title:** voidmain
**Subtitle:** Adaptive Intelligent IoT Systems — many sensors, one brain,
coordinated responses.
**Tagline strip:** Farlands Innovation Mission 7 · Built on the ULTRON IoT
security platform
**Visual:** Large centered wordmark "voidmain" with a violet→teal gradient;
behind it, a faint animated-looking node graph (sensors connected to a central
decision core). Footer: team name, event badge, "Stage 1 — Foundation ✅".
**Speaker notes:** One-liner: "Most smart-home automation reacts to single
sensor beeps. voidmain reacts to the whole situation — multiple sensors in,
multiple coordinated actions out."

## SLIDE 2 — The Problem
**Title:** Automation that reacts — but doesn't understand
**Bullets (verbatim problem framing from Mission 7):**
- Traditional automation reacts to *individual* sensor readings…
- …without understanding the overall condition of the environment.
- Threshold rules alone: one sensor → one action → blind to context.
- Examples: light turns on in an empty dark room; alarm ignored because
  "temperature still normal"; a dead sensor silently feeds stale data.
- Result: brittle, unsafe, non-adaptive smart homes.
**Visual:** Left side: fragmented icons (single sensor → single bulb) in grey.
Right side: dim, broken chain graphic. A red "✕ context missing" stamp.
**Speaker notes:** Mission 7's exact problem statement: systems react to
individual readings without environmental context. That's the gap voidmain
fills.

## SLIDE 3 — The Solution
**Title:** voidmain: one deterministic brain for the whole environment
**Bullets:**
- Multiple sensors publish normalized events over local MQTT.
- A deterministic decision engine fuses inputs against explicit policies.
- One decision → coordinated commands to multiple actuators.
- Every decision is explainable: policy ID, reason, triggering event IDs.
- Acknowledgements + SQLite event/decision log for full auditability.
- Optional AI only *explains* events — it never issues control commands.
**Visual:** Three-stage horizontal flow with glowing connectors:
SENSE → DECIDE → ACT, each in a glass card; violet→teal gradient arrows.
**Speaker notes:** Multiple sensing components working together to influence
coordinated responses — the core of Mission 7's Build requirement. Decisions
are deterministic and testable, not LLM guesswork.

## SLIDE 4 — Architecture
**Title:** How the loop works
**Content (flow diagram, top to bottom):**
```
Sensors / Events (real ESP32 adapters or clearly-labelled simulators)
        ↓
Event Normalization (versioned schema: event_id, timestamp, source,
        simulation flag, quality)
        ↓
MQTT broker (localhost Mosquitto — ultron/events, decisions, commands, acks)
        ↓
Decision Engine (rules + risk fusion 0–100 → GREEN/YELLOW/RED/PURPLE)
        ↓
Policy Evaluation (allowlisted actions only, command timeouts)
        ↓
Coordinated Actuator Commands (validated, idempotent)
        ↓
Outputs (lights, alarms, barriers, displays) + Acknowledgements
        ↓
Event/Decision Log (SQLite) → Operator Dashboard (live, <100ms)
```
**Visual:** Vertical pipeline diagram in SVG style, each stage a rounded glass
node; side-branch from Log to Dashboard. Icons per stage. Simulated inputs
tagged with a small "SIM" chip.
**Speaker notes:** One event → decision → action loop, fully observable:
correlation IDs tie sensor event, decision, command, acknowledgement, and log
entry together.

## SLIDE 5 — Demo Scenarios (multi-input, multi-output)
**Title:** Multiple sensors, coordinated responses — live
**Bullets:**
1. **Occupancy-aware lighting** — input: occupancy + room darkness → one
   decision turns ON the whole lighting group.
2. **Environmental hazard response** — input: simulated temperature over
   threshold + occupancy known → alarm state: warning lamps + alarm sound +
   high-priority log entry; deterministic recovery when clear.
3. **Stale-sensor fail-safe** — sensor goes silent → marked UNKNOWN, safe
   default applied, fault indicator lit — never silently trust old data.
4. **Restricted-area policy** — access attempt evaluated against explicit
   allow/deny policy → barrier state + indicator + logged reason.
**Visual:** 2×2 grid of scenario cards, each with input-chips → decision-node
→ output-dots micro-diagrams. Green check badges.
**Speaker notes:** Minimum deliverable: multiple sensors influencing
coordinated responses across multiple connected components. Every scenario
shows ≥2 inputs driving ≥2 outputs through one explainable decision.

## SLIDE 6 — Why it wins (Judging focus alignment)
**Title:** Built exactly to the judging criteria
**Content (two-column table style):**
| Judging Focus | How voidmain delivers |
|---|---|
| Sensor integration | Normalized multi-source event schema over MQTT |
| Coordination | One decision fans out to multiple actuators |
| Adaptive behaviour | Context rules + risk bands + fail-safe policies |
| Functionality | Full loop: sensor → decision → world change → ack → log |
| Intelligent decision-making | Deterministic rules + explainable risk fusion |
**Plus a footer strip:** "Simulated sensors clearly labelled · No cloud ·
Local-only · Dashboard preserved from ULTRON · Works without physical
hardware."
**Visual:** Checklist-style rows with teal checkmarks; ULTRON badge lineage
mark bottom-right.
**Speaker notes:** Constraints allow physical or simulated sensor data — our
simulated inputs are explicitly flagged in every event payload, and the same
decision engine will drive physical ESP32 hardware via adapters later.

## SLIDE 7 — Roadmap / Stages
**Title:** From foundation to intelligence
**Bullets:**
- **Stage 1 — Foundation ✅ (this deck):** multi-sensor event pipeline,
  MQTT backbone, dashboard, event/decision log working locally.
- **Stage 2 — Functional Solution:** full multi-input → multi-output
  coordination demo; acknowledgements, stale handling, end-to-end tests.
- **Stage 3 — Innovation (optional):** anomaly detection, pattern analysis,
  prediction on the event history using the ULTRON risk engine.
- Closing line: **Reliability over feature count — one complete,
  observable, repeatable control loop first.**
**Visual:** Horizontal 3-step progress bar; Stage 1 fully filled violet,
Stage 2 outlined, Stage 3 dashed/teal. Small ULTRON → voidmain evolution
arrow. Team + contact footer.
**Speaker notes:** Stage 1 is complete and demonstrated today; Stage 2 adds
coordination depth; Stage 3 adds adaptive intelligence on top of a proven,
reliable loop.
````

---

## Slide content source notes (for the human, not the generator)

- Mission 7 text is verbatim from the official Farlands problem-statements PDF:
  *"Connected Infrastructure: Adaptive Intelligent IoT Systems."*
- ULTRON lineage facts used: MQTT topics (`ultron/events|decisions|commands|
  acks|status`), risk bands GREEN 0–29 / YELLOW 30–59 / RED 60–84 / PURPLE
  85–100, SQLite evidence, premium dashboard preserved unchanged.
- Honesty rules baked in: simulated readings labelled `simulated`, no claimed
  hardware validation, no LLM in the control path, local-only networking.

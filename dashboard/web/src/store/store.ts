import { useCallback, useRef, useSyncExternalStore } from "react";
import type { AlertD, Band, DeviceD, EventD, Envelope, LanD } from "../contracts/ws";
import { bandForScore, isWorse } from "../lib/bands";
import { ClockSync, LatencyWindow } from "../lib/latency";

export type Conn = "live" | "stale" | "offline";

export interface NodeHealth { up?: number; lastSeen: number; }
export interface Layers {
  idsCount: number; idsLast: number; lanToday: number;
  wifiRogue: boolean; wifiLast: number; tripLast: number; tripSeq: number;
}
export interface Pipeline { detect: number; govern: number; alert: number; }

export interface UEvent {
  id: string;
  ts: number;
  kind: "alert" | "suricata" | "wifi" | "lan" | "tripwire" | "band" | "device" | "automation";
  node: string;
  sev: string;
  summary: string;
  derived?: boolean;
  alertId?: string;
  ack?: boolean;
  ackTs?: number;
  src_ip?: string;
  dest_ip?: string;
  mac?: string;
}

export interface LanDevice {
  mac: string;
  ip?: string;
  vendor?: string;
  known?: boolean;
  firstSeen?: number;
  lastSeen?: number;
}

export interface IoTDevice {
  id: string;
  name: string;
  kind: string;
  room: string;
  on?: boolean;
  locked?: boolean;
  burning?: boolean;
  sev: string;
  state: string;
  automation?: string;
  lastSeen: number;
}

export interface CommandEntry {
  id: string;
  ts: number;
  command: string;
  result: string;
  ok: boolean;
}

export type AuthPhase = "checking" | "setup" | "login" | "ready";

export interface State {
  authPhase: AuthPhase;
  authHasOwner: boolean;
  conn: Conn;
  degraded: boolean;
  score: number;
  scoreTs: number;
  band: Band;
  bandBump: number;
  history: Array<[number, number]>;
  alerts: AlertD[];
  openCount: number;
  ackTotal: number;
  ackDone: number;
  eventCount: number;
  nodes: Record<string, NodeHealth>;
  layers: Layers;
  pipeline: Pipeline;
  latencyLast: number;
  latencyP95: number;
  clockReady: boolean;
  clockUncertaintyMs: number;
  lastToast: { msg: string; sev: string; at: number } | null;
  events: UEvent[];
  devices: Record<string, LanDevice>;
  iot: Record<string, IoTDevice>;
  commandHistory: CommandEntry[];
  muteUntil: number;
  focusNode: string | null;
  eventFilter: string;
  showDevices: boolean;
  simRunning: boolean;
  simPaused: boolean;
  selectedDevice: string | null;
  historyRange: "1h" | "6h" | "24h";
}

const MAX_ALERTS = 200;
const MAX_EVENTS = 500;
const MAX_DEVICES = 500;
const MAX_CMD_HISTORY = 100;

function initial(): State {
  return {
    authPhase: "checking", authHasOwner: false,
    conn: "offline", degraded: false, score: 0, scoreTs: 0, band: "GREEN", bandBump: 0,
    history: [], alerts: [], openCount: 0, ackTotal: 0, ackDone: 0, eventCount: 0,
    nodes: {}, layers: { idsCount: 0, idsLast: 0, lanToday: 0, wifiRogue: false, wifiLast: 0, tripLast: 0, tripSeq: 0 },
    pipeline: { detect: 0, govern: 0, alert: 0 },
    latencyLast: 0, latencyP95: 0, clockReady: false, clockUncertaintyMs: Infinity, lastToast: null,
    events: [], devices: {}, iot: {}, commandHistory: [], muteUntil: 0, focusNode: null, eventFilter: "all", showDevices: false,
    simRunning: false, simPaused: false, selectedDevice: null, historyRange: "24h",
  };
}

let _evId = 0;
function nextEvId(): string { return `ev-${++_evId}-${Date.now()}`; }

export class Store {
  private state: State = initial();
  private listeners = new Set<() => void>();
  private seen = new Set<string>();
  readonly clock = new ClockSync();
  readonly latency = new LatencyWindow(100);

  getState = (): State => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    for (const l of this.listeners) l();
  }

  setAuth(authenticated: boolean, hasOwner: boolean): void {
    const phase: AuthPhase = authenticated ? "ready" : hasOwner ? "login" : "setup";
    if (this.state.authPhase === phase && this.state.authHasOwner === hasOwner) return;
    this.state = { ...this.state, authPhase: phase, authHasOwner: hasOwner };
    this.emit();
  }

  setConn(conn: Conn): void {
    if (this.state.conn === conn) return;
    this.state = { ...this.state, conn };
    this.emit();
  }

  setDegraded(v: boolean): void {
    if (this.state.degraded === v) return;
    this.state = { ...this.state, degraded: v };
    this.emit();
  }

  recordPong(clientSent: number, serverMs: number): void {
    this.clock.addPong(clientSent, serverMs, Date.now());
    this.state = {
      ...this.state,
      clockReady: this.clock.ready(),
      clockUncertaintyMs: this.clock.uncertaintyMs(),
    };
    this.emit();
  }

  recordLatency(serverTsSec: number, paintClientMs: number): void {
    if (!this.clock.ready() || !serverTsSec) return;
    const paintServerMs = paintClientMs + this.clock.offsetMs();
    const ms = paintServerMs - serverTsSec * 1000;
    if (ms >= 0 && ms < 60000) this.latency.add(ms);
  }

  setFocusNode(node: string | null): void {
    this.state = { ...this.state, focusNode: node };
    this.emit();
  }

  setEventFilter(filter: string): void {
    this.state = { ...this.state, eventFilter: filter };
    this.emit();
  }

  setMuteUntil(ts: number): void {
    this.state = { ...this.state, muteUntil: ts };
    this.emit();
  }

  setShowDevices(v: boolean): void {
    if (this.state.showDevices === v) return;
    this.state = { ...this.state, showDevices: v };
    this.emit();
  }

  setSimRunning(v: boolean): void {
    if (this.state.simRunning === v) return;
    this.state = { ...this.state, simRunning: v };
    this.emit();
  }

  setSimPaused(v: boolean): void {
    if (this.state.simPaused === v) return;
    this.state = { ...this.state, simPaused: v };
    this.emit();
  }

  resetSimState(): void {
    const ts = Math.floor(Date.now() / 1000);
    const iot: Record<string, IoTDevice> = {
      ...this.state.iot,
      "door-front": { id: "door-front", name: "Front Door", kind: "lock", room: "Entrance", sev: "green", state: "Locked", locked: true, lastSeen: ts },
      "camera-front": { id: "camera-front", name: "Front Camera", kind: "camera", room: "Entrance", sev: "green", state: "Armed recording", on: true, lastSeen: ts },
      "air-purifier": { id: "air-purifier", name: "Air Purifier", kind: "purifier", room: "Living Room", sev: "green", state: "On auto", on: true, lastSeen: ts },
      "campfire": { id: "campfire", name: "Campfire", kind: "extinguish", room: "Backyard", sev: "green", state: "Burning", burning: true, lastSeen: ts },
      "perimeter": { id: "perimeter", name: "Perimeter Sensor", kind: "perimeter", room: "Yard", sev: "green", state: "Clear", lastSeen: ts },
      "smoke-detector": { id: "smoke-detector", name: "Smoke Detector", kind: "smoke", room: "Kitchen", sev: "green", state: "Clear", lastSeen: ts },
    };
    const alerts = this.state.alerts.map((a) => ({ ...a, ack: true, ack_ts: ts }));
    const nodes = { ...this.state.nodes };
    for (const node of ["pi4", "pi3a", "pi3b", "esp32"]) {
      nodes[node] = { up: 3600, lastSeen: ts };
    }
    const events = this.state.events.slice();
    this.pushEvent({
      id: nextEvId(),
      ts,
      kind: "band",
      node: "governance",
      sev: "green",
      summary: "Board reset in its entirety — baseline GREEN",
      derived: true,
    }, events);
    this.state = {
      ...this.state,
      score: 6,
      scoreTs: ts,
      band: "GREEN",
      bandBump: 0,
      simRunning: false,
      simPaused: false,
      openCount: 0,
      iot,
      alerts,
      nodes,
      events,
      lastToast: { msg: "Board reset in its entirety — baseline GREEN", sev: "green", at: Date.now() },
    };
    this.emit();
  }

  setSelectedDevice(mac: string | null): void {
    if (this.state.selectedDevice === mac) return;
    this.state = { ...this.state, selectedDevice: mac };
    this.emit();
  }

  setHistoryRange(r: "1h" | "6h" | "24h"): void {
    if (this.state.historyRange === r) return;
    this.state = { ...this.state, historyRange: r };
    this.emit();
  }

  clearToast(): void {
    if (!this.state.lastToast) return;
    this.state = { ...this.state, lastToast: null };
    this.emit();
  }

  addCommand(cmd: CommandEntry): void {
    const history = [cmd, ...this.state.commandHistory];
    if (history.length > MAX_CMD_HISTORY) history.length = MAX_CMD_HISTORY;
    this.state = { ...this.state, commandHistory: history };
    this.emit();
  }

  private pushEvent(ev: UEvent, events: UEvent[]): UEvent[] {
    events.unshift(ev);
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
    return events;
  }

  applyBatch(list: Envelope[]): void {
    const s: State = { ...this.state };
    s.nodes = { ...s.nodes };
    s.layers = { ...s.layers };
    s.pipeline = { ...s.pipeline };
    s.devices = { ...s.devices };
    s.iot = { ...s.iot };
    let alertsChanged = false;
    let eventsChanged = false;
    let alerts = s.alerts;
    let events = s.events;

    for (const env of list) {
      switch (env.t) {
        case "score": {
          const v = (env.d as { v: number }).v;
          s.score = v; s.scoreTs = env.ts;
          s.history = s.history.concat([[env.ts, v]]);
          if (s.history.length > 2880) s.history = s.history.slice(-2880);
          const derivedBand = bandForScore(v);
          if (derivedBand !== s.band) {
            if (isWorse(derivedBand, s.band)) s.bandBump = s.bandBump + 1;
            s.band = derivedBand;
          }
          s.pipeline.govern = env.ts;
          break;
        }
        case "band": {
          const b = (env.d as { b: Band }).b;
          const prev = s.band;
          if (isWorse(b, s.band)) s.bandBump = s.bandBump + 1;
          s.band = b; s.pipeline.govern = env.ts;
          if (b !== prev) {
            if (!eventsChanged) { events = events.slice(); eventsChanged = true; }
            this.pushEvent({
              id: nextEvId(), ts: env.ts, kind: "band", node: "pi4",
              sev: b.toLowerCase(), summary: `Band changed to ${b}`, derived: true,
            }, events);
            s.eventCount += 1;
          }
          break;
        }
        case "history": {
          s.history = (env.d as { points: Array<[number, number]> }).points.slice();
          if (s.history.length) s.score = s.history[s.history.length - 1]![1];
          break;
        }
        case "health": {
          const d = env.d as { node: string; up?: number };
          const id = d.node.startsWith("esp") ? "esp32" : d.node;
          s.nodes[id] = { up: d.up, lastSeen: Date.now() };
          if (id === "pi4") s.pipeline.govern = env.ts;
          else if (id === "pi3a") s.pipeline.detect = env.ts;
          else if (id === "pi3b") s.pipeline.alert = env.ts;
          break;
        }
        case "lan": {
          const d = env.d as LanD;
          s.layers.lanToday += 1; s.eventCount += 1; s.pipeline.detect = env.ts;
          if (!eventsChanged) { events = events.slice(); eventsChanged = true; }
          this.pushEvent({
            id: nextEvId(), ts: env.ts, kind: "lan", node: "pi3a",
            sev: d.known === false ? "yellow" : "info",
            summary: `${d.known === false ? "Unknown" : "Known"} device ${d.mac}${d.vendor ? ` (${d.vendor})` : ""}${d.ip ? ` · ${d.ip}` : ""}`,
            derived: true, mac: d.mac,
          }, events);
          if (d.mac && Object.keys(s.devices).length < MAX_DEVICES) {
            const existing = s.devices[d.mac];
            s.devices[d.mac] = {
              mac: d.mac, ip: d.ip ?? existing?.ip,
              vendor: d.vendor ?? existing?.vendor,
              known: d.known ?? existing?.known,
              firstSeen: existing?.firstSeen ?? (d.first_seen ?? env.ts),
              lastSeen: d.last_seen ?? env.ts,
            };
          }
          break;
        }
        case "tripwire": {
          const d = env.d as { node: string; edge: string };
          s.layers.tripLast = env.ts; s.layers.tripSeq += 1; s.eventCount += 1;
          if (d.node === "pi3b") s.pipeline.alert = env.ts; else s.pipeline.detect = env.ts;
          if (!eventsChanged) { events = events.slice(); eventsChanged = true; }
          this.pushEvent({
            id: nextEvId(), ts: env.ts, kind: "tripwire", node: d.node,
            sev: d.edge === "open" ? "red" : "info",
            summary: `Tripwire ${d.edge} on ${d.node}`, derived: true,
          }, events);
          break;
        }
        case "event": {
          const d = env.d as EventD;
          s.eventCount += 1;
          if (!eventsChanged) { events = events.slice(); eventsChanged = true; }
          this.pushEvent({
            id: nextEvId(), ts: env.ts, kind: d.kind, node: d.node,
            sev: d.sev, summary: d.summary,
            src_ip: d.src_ip, dest_ip: d.dest_ip, mac: d.mac,
          }, events);
          if (d.kind === "suricata") {
            s.layers.idsCount += 1; s.layers.idsLast = env.ts; s.pipeline.detect = env.ts;
          }
          if (d.kind === "wifi") {
            s.layers.wifiRogue = true; s.layers.wifiLast = env.ts; s.pipeline.detect = env.ts;
          }
          break;
        }
        case "alert": {
          const d = env.d as AlertD;
          if (!d.id) break;
          if (this.seen.has(d.id)) {
            // ACK update for an alert already on screen: the director republishes
            // the same id with ack:true after voidmain/ack/<id>, so every open
            // laptop flips together instead of the frame being dropped.
            if (d.ack) {
              const idx = alerts.findIndex((a) => a.id === d.id);
              if (idx >= 0 && !alerts[idx]!.ack) {
                if (!alertsChanged) { alerts = alerts.slice(); alertsChanged = true; }
                alerts[idx] = { ...alerts[idx]!, ack: true, ack_ts: d.ack_ts ?? null };
                if (s.openCount > 0) s.openCount -= 1;
                s.ackDone += 1;
              }
            }
            break;
          }
          this.seen.add(d.id);
          if (!alertsChanged) { alerts = alerts.slice(); alertsChanged = true; }
          alerts.unshift(d);
          if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS;
          s.eventCount += 1;
          s.ackTotal += 1;
          if (d.ack) s.ackDone += 1; else s.openCount += 1;
          s.pipeline.alert = env.ts;
          if (!eventsChanged) { events = events.slice(); eventsChanged = true; }
          this.pushEvent({
            id: nextEvId(), ts: d.ts ?? env.ts, kind: "alert", node: (d.src || "").includes("pi3b") ? "pi3b" : "pi4",
            sev: d.sev || "info", summary: d.title || d.body || "Alert",
            alertId: d.id, ack: d.ack, ackTs: d.ack_ts ?? undefined,
          }, events);
          break;
        }
        case "toast": {
          const d = env.d as { msg: string; sev: string };
          if (d.msg === "MQTT DEGRADED") s.degraded = true;
          else if (d.msg === "MQTT LIVE") s.degraded = false;
          s.lastToast = { msg: d.msg, sev: d.sev, at: Date.now() };
          break;
        }
        case "device": {
          const d = env.d as DeviceD;
          if (!d.id) break;
          const prev = s.iot[d.id];
          s.iot[d.id] = {
            id: d.id, name: d.name || d.id, kind: d.kind || "sensor", room: d.room || "—",
            on: d.on ?? prev?.on, locked: d.locked ?? prev?.locked,
            sev: d.sev || "green", state: d.state || "—",
            automation: d.automation, lastSeen: env.ts,
          };
          s.eventCount += 1;
          if (d.sev === "purple" && d.automation) {
            if (!eventsChanged) { events = events.slice(); eventsChanged = true; }
            this.pushEvent({
              id: nextEvId(), ts: env.ts, kind: "automation", node: d.id,
              sev: "purple", summary: `Automation: ${d.automation}`, derived: true,
            }, events);
          } else if (prev && d.sev !== prev.sev) {
            if (!eventsChanged) { events = events.slice(); eventsChanged = true; }
            this.pushEvent({
              id: nextEvId(), ts: env.ts, kind: "device", node: d.id,
              sev: d.sev, summary: `${d.name || d.id}: ${d.state}`, derived: true,
            }, events);
          }
          break;
        }
      }
    }
    if (alertsChanged) s.alerts = alerts;
    if (eventsChanged) s.events = events;
    s.latencyLast = Math.round(this.latency.last);
    s.latencyP95 = Math.round(this.latency.p95());
    this.state = s;
    this.emit();
  }

  ackLocal(id: string): void {
    const idx = this.state.alerts.findIndex((a) => a.id === id);
    if (idx < 0 || this.state.alerts[idx]!.ack) return;
    const alerts = this.state.alerts.slice();
    alerts[idx] = { ...alerts[idx]!, ack: true, ack_ts: Math.floor(Date.now() / 1000) };
    const events = this.state.events.map((e) =>
      e.alertId === id ? { ...e, ack: true, ackTs: Math.floor(Date.now() / 1000) } : e
    );
    this.state = {
      ...this.state, alerts, events,
      openCount: Math.max(0, this.state.openCount - 1),
      ackDone: this.state.ackDone + 1,
    };
    this.emit();
  }

  seedDev(s: Partial<State>): void {
    this.state = { ...this.state, ...s };
    this.emit();
  }
}

export const store = new Store();

export function useStore<T>(selector: (s: State) => T): T {
  const last = useRef<T | null>(null);
  const getSnapshot = useCallback((): T => {
    const next = selector(store.getState());
    const prev = last.current;
    if (prev !== null && shallowEqual(prev, next)) return prev;
    last.current = next;
    return next;
  }, [selector]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

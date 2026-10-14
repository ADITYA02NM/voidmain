// WS contract (dashboard.md §5). t:"event" added for suricata/wifi passthrough.

export type Band = "GREEN" | "YELLOW" | "RED" | "PURPLE";
export const BANDS: Band[] = ["GREEN", "YELLOW", "RED", "PURPLE"];

export type Severity = "green" | "info" | "yellow" | "warn" | "red" | "critical" | "purple";

export type EnvelopeType =
  | "alert" | "score" | "band" | "health" | "lan" | "tripwire"
  | "history" | "toast" | "event";

export interface ScoreD { v: number; }
export interface BandD { b: Band; }
export interface AlertD {
  id: string; sev: Severity; title: string; src: string; body: string;
  ts?: number; ack: boolean; ack_ts?: number | null;
}
export interface HealthD { node: string; up?: number; services?: string[]; }
export interface LanD {
  mac: string; ip?: string; vendor?: string; known?: boolean;
  first_seen?: number; last_seen?: number;
}
export interface TripwireD { node: string; edge: string; }
export interface HistoryD { points: Array<[number, number]>; }
export interface ToastD { msg: string; sev: string; }
export interface EventD {
  topic: string; node: string; kind: "suricata" | "wifi";
  sev: string; summary: string;
  src_ip?: string; dest_ip?: string; mac?: string; sig_id?: number;
}

export type PayloadFor<T extends EnvelopeType> =
  T extends "score" ? ScoreD :
  T extends "band" ? BandD :
  T extends "alert" ? AlertD :
  T extends "health" ? HealthD :
  T extends "lan" ? LanD :
  T extends "tripwire" ? TripwireD :
  T extends "history" ? HistoryD :
  T extends "toast" ? ToastD :
  T extends "event" ? EventD : never;

export interface Envelope<T extends EnvelopeType = EnvelopeType> {
  t: T;
  ts: number;
  d: PayloadFor<T>;
}

// Transport-level control frames (never envelope data, never MQTT).
export interface Ping { ctl: "ping"; c: number; }
export interface Pong { ctl: "pong"; c: number; s: number; }
export interface AckMsg { ack: string; }
export type ClientMessage = AckMsg | Ping;
export type ServerControl = Pong;

// Runtime guards used by the contract-check panel in debug.html and the store.
const T_SET = new Set<EnvelopeType>([
  "alert", "score", "band", "health", "lan", "tripwire", "history", "toast", "event",
]);

export function isEnvelope(x: unknown): x is Envelope {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.t === "string" && T_SET.has(o.t as EnvelopeType)
    && typeof o.ts === "number" && "d" in o;
}

export function isPong(x: unknown): x is Pong {
  return typeof x === "object" && x !== null
    && (x as Record<string, unknown>).ctl === "pong";
}

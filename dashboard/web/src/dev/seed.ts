import { store } from "../store/store";
import type { Band } from "../contracts/ws";
import type { AlertD } from "../contracts/ws";
import type { UEvent, LanDevice, CommandEntry, IoTDevice } from "../store/store";

const SCORE: Record<Band, number> = { GREEN: 12, YELLOW: 45, RED: 72, PURPLE: 92 };

export function seedForDesign(band: Band): void {
  const nowSec = Math.floor(Date.now() / 1000);
  const score = SCORE[band];

  const history: Array<[number, number]> = [];
  for (let i = 40; i >= 0; i--) {
    const v = Math.max(2, Math.round(score - i * 1.2 + Math.sin(i / 3) * 6));
    history.push([nowSec - i * 60, Math.min(100, v)]);
  }

  const alerts: AlertD[] = [
    { id: "s1", sev: band === "PURPLE" ? "purple" : "red", title: "Intrusion alert — door + camera", src: "iot/door-front", body: "Front door opened unexpectedly + camera person detection.", ts: nowSec - 20, ack: false },
    { id: "s2", sev: "yellow", title: "Unusual motion detected", src: "iot/motion-hall", body: "Hall motion triggered at 02:14 — no one home.", ts: nowSec - 80, ack: true, ack_ts: nowSec - 60 },
    { id: "s3", sev: "yellow", title: "Water leak under sink", src: "iot/leak-utility", body: "Moisture sensor triggered — utility room.", ts: nowSec - 140, ack: false },
    { id: "s4", sev: "info", title: "Morning routine", src: "iot/auto", body: "Coffee plug ON · purifier auto · curtain closed.", ts: nowSec - 200, ack: true, ack_ts: nowSec - 180 },
  ];

  const events: UEvent[] = [
    { id: "ev-s-1", ts: nowSec - 8, kind: "device", node: "door-front", sev: band === "PURPLE" ? "purple" : "red",
      summary: "Front Door — opened unexpectedly" },
    { id: "ev-s-2", ts: nowSec - 20, kind: "alert", node: "pi3b", sev: band === "PURPLE" ? "purple" : "red",
      summary: "Intrusion alert — door + camera + perimeter", alertId: "s1", ack: false },
    { id: "ev-s-3", ts: nowSec - 35, kind: "automation", node: "iot/auto", sev: "purple",
      summary: "Door locked · camera high-res · air purifier boosted · perimeter secured · campfire extinguished", derived: true },
    { id: "ev-s-4", ts: nowSec - 60, kind: "device", node: "camera-front", sev: "red",
      summary: "Front Camera — person detected" },
    { id: "ev-s-5", ts: nowSec - 80, kind: "alert", node: "pi3b", sev: "yellow",
      summary: "Perimeter sensor triggered after hours", alertId: "s2", ack: true, ackTs: nowSec - 60 },
    { id: "ev-s-6", ts: nowSec - 110, kind: "device", node: "perimeter", sev: "yellow",
      summary: "Perimeter Sensor — motion after hours" },
    { id: "ev-s-7", ts: nowSec - 140, kind: "alert", node: "pi3b", sev: "yellow",
      summary: "Air purifier filter low", alertId: "s3", ack: false },
    { id: "ev-s-8", ts: nowSec - 170, kind: "device", node: "air-purifier", sev: "yellow",
      summary: "Air Purifier — filter low" },
    { id: "ev-s-9", ts: nowSec - 200, kind: "alert", node: "pi4", sev: "info",
      summary: "Routine check — perimeter nominal", alertId: "s4", ack: true, ackTs: nowSec - 180 },
    { id: "ev-s-10", ts: nowSec - 250, kind: "band", node: "pi4", sev: band.toLowerCase(),
      summary: `Band changed to ${band}`, derived: true },
    { id: "ev-s-11", ts: nowSec - 320, kind: "device", node: "perimeter", sev: "info",
      summary: "Perimeter Sensor — clear" },
    { id: "ev-s-12", ts: nowSec - 400, kind: "device", node: "air-purifier", sev: "info",
      summary: "Air Purifier — on auto" },
  ];

  const devices: Record<string, LanDevice> = {};

  const iot: Record<string, IoTDevice> = {
    "campfire": { id: "campfire", name: "Campfire", kind: "extinguish", room: "Backyard", burning: true as const, sev: band === "PURPLE" ? "purple" : "green", state: band === "PURPLE" ? "Extinguished" : band === "RED" ? "Smoldering" : band === "YELLOW" ? "Waning" : "Burning", automation: band === "PURPLE" ? "Campfire extinguished by automation" : undefined, lastSeen: nowSec },
    "air-purifier": { id: "air-purifier", name: "Air Purifier", kind: "purifier", room: "Living Room", on: true as const, sev: band === "PURPLE" ? "purple" : band === "YELLOW" ? "yellow" : "green", state: band === "PURPLE" ? "Boosted" : band === "YELLOW" ? "Filter low" : "On · Auto", automation: band === "PURPLE" ? "Air purifier boosted" : undefined, lastSeen: nowSec },
    "door-front": { id: "door-front", name: "Front Door", kind: "lock", room: "Entrance", locked: band === "PURPLE" ? true : band === "GREEN" ? true : false, sev: band === "PURPLE" ? "purple" : band === "RED" ? "red" : band === "YELLOW" ? "yellow" : "green", state: band === "PURPLE" ? "Auto-locked" : band === "RED" ? "Opened unexpectedly" : band === "YELLOW" ? "Ajar" : "Locked", automation: band === "PURPLE" ? "Door locked remotely" : undefined, lastSeen: nowSec },
    "camera-front": { id: "camera-front", name: "Front Camera", kind: "camera", room: "Entrance", on: true, sev: band === "PURPLE" ? "purple" : band === "RED" ? "red" : band === "YELLOW" ? "yellow" : "green", state: band === "PURPLE" ? "High-res recording" : band === "RED" ? "Person detected" : band === "YELLOW" ? "Motion clip saved" : "Armed recording", automation: band === "PURPLE" ? "Camera switched to high-res" : undefined, lastSeen: nowSec },
    "perimeter": { id: "perimeter", name: "Perimeter Sensor", kind: "perimeter", room: "Yard", sev: band === "PURPLE" ? "purple" : band === "RED" ? "red" : band === "YELLOW" ? "yellow" : "green", state: band === "PURPLE" ? "Perimeter secured" : band === "RED" ? "Perimeter breached" : band === "YELLOW" ? "Motion after hours" : "Clear", automation: band === "PURPLE" ? "Perimeter integrity restored" : undefined, lastSeen: nowSec },
  };

  const commandHistory: CommandEntry[] = [
    { id: "cmd-s-1", ts: Date.now() - 30000, command: "/health",
      result: "pi4: 2s ago · up 90000s\npi3a: 3s ago · up 90000s\npi3b: 5s ago · up 90000s", ok: true },
    { id: "cmd-s-2", ts: Date.now() - 120000, command: "/latency",
      result: "Last: 41ms · p95: 63ms · Clock uncertainty: 4ms", ok: true },
    { id: "cmd-s-3", ts: Date.now() - 300000, command: "/filter type:device",
      result: "Filter set: type:device", ok: true },
    { id: "cmd-s-4", ts: Date.now() - 600000, command: "/ack all",
      result: "ACK sent for 2 alerts", ok: true },
  ];

  store.seedDev({
    conn: "live", degraded: false, score, scoreTs: nowSec, band,
    history, alerts, openCount: 2, ackTotal: 4, ackDone: 2, eventCount: 37,
    events, devices, iot, commandHistory,
    nodes: {
      pi4: { up: 90000, lastSeen: Date.now() },
      pi3a: { up: 90000, lastSeen: Date.now() },
      pi3b: { up: 90000, lastSeen: Date.now() },
    },
    layers: { idsCount: 6, idsLast: nowSec - 20, lanToday: 0, wifiRogue: false, wifiLast: nowSec - 140, tripLast: nowSec - 80, tripSeq: 1 },
    pipeline: { detect: nowSec, govern: nowSec, alert: nowSec - 20 },
    latencyLast: 41, latencyP95: 63, clockReady: true, clockUncertaintyMs: 4,
  });
}

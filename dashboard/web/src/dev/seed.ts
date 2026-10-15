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
      summary: "Intrusion alert — door + camera", alertId: "s1", ack: false },
    { id: "ev-s-3", ts: nowSec - 35, kind: "automation", node: "iot/auto", sev: "purple",
      summary: "Auto-locked front door · lights ON · camera high-res", derived: true },
    { id: "ev-s-4", ts: nowSec - 60, kind: "device", node: "camera-front", sev: "red",
      summary: "Front Camera — person detected", derived: true },
    { id: "ev-s-5", ts: nowSec - 80, kind: "alert", node: "pi3b", sev: "yellow",
      summary: "Unusual motion detected", alertId: "s2", ack: true, ackTs: nowSec - 60 },
    { id: "ev-s-6", ts: nowSec - 110, kind: "device", node: "motion-hall", sev: "yellow",
      summary: "Hall Motion — motion after hours" },
    { id: "ev-s-7", ts: nowSec - 140, kind: "alert", node: "pi3b", sev: "yellow",
      summary: "Water leak under sink", alertId: "s3", ack: false },
    { id: "ev-s-8", ts: nowSec - 170, kind: "device", node: "leak-utility", sev: "yellow",
      summary: "Utility Leak — moisture detected", derived: true },
    { id: "ev-s-9", ts: nowSec - 200, kind: "alert", node: "pi4", sev: "info",
      summary: "Morning routine", alertId: "s4", ack: true, ackTs: nowSec - 180 },
    { id: "ev-s-10", ts: nowSec - 250, kind: "band", node: "pi4", sev: band.toLowerCase(),
      summary: `Band changed to ${band}`, derived: true },
    { id: "ev-s-11", ts: nowSec - 320, kind: "device", node: "thermostat", sev: "yellow",
      summary: "Thermostat — 24°C rising unexpectedly" },
    { id: "ev-s-12", ts: nowSec - 400, kind: "automation", node: "iot/auto", sev: "green",
      summary: "Coffee plug ON · purifier auto", derived: true },
    { id: "ev-s-13", ts: nowSec - 500, kind: "device", node: "smoke-kitchen", sev: "info",
      summary: "Kitchen Smoke — clear" },
    { id: "ev-s-14", ts: nowSec - 600, kind: "device", node: "garage", sev: "info",
      summary: "Garage Door — closed" },
  ];

  const devices: Record<string, LanDevice> = {};

  const iot: Record<string, IoTDevice> = {
    "door-front": { id: "door-front", name: "Front Door", kind: "lock", room: "Entrance", locked: true, sev: band === "PURPLE" ? "purple" : "red", state: "Opened unexpectedly", lastSeen: nowSec },
    "door-back": { id: "door-back", name: "Back Door", kind: "lock", room: "Kitchen", locked: true, sev: "green", state: "Locked", lastSeen: nowSec },
    "light-living": { id: "light-living", name: "Living Light", kind: "light", room: "Living Room", on: true, sev: "purple", state: "All lights ON", automation: "Turned on all lights", lastSeen: nowSec },
    "light-bedroom": { id: "light-bedroom", name: "Bedroom Light", kind: "light", room: "Bedroom", on: true, sev: "purple", state: "All lights ON", automation: "Turned on all lights", lastSeen: nowSec },
    "light-porch": { id: "light-porch", name: "Porch Light", kind: "light", room: "Entrance", on: false, sev: "green", state: "Off", lastSeen: nowSec },
    "thermostat": { id: "thermostat", name: "Thermostat", kind: "thermostat", room: "Hallway", sev: "yellow", state: "24°C · Rising", lastSeen: nowSec },
    "garage": { id: "garage", name: "Garage Door", kind: "garage", room: "Garage", locked: true, sev: "green", state: "Closed", lastSeen: nowSec },
    "plug-coffee": { id: "plug-coffee", name: "Coffee Plug", kind: "plug", room: "Kitchen", on: true, sev: "green", state: "On", lastSeen: nowSec },
    "plug-desk": { id: "plug-desk", name: "Desk Plug", kind: "plug", room: "Office", on: true, sev: "green", state: "On", lastSeen: nowSec },
    "motion-hall": { id: "motion-hall", name: "Hall Motion", kind: "motion", room: "Hallway", sev: "yellow", state: "Motion after hours", lastSeen: nowSec },
    "motion-yard": { id: "motion-yard", name: "Yard Motion", kind: "motion", room: "Yard", sev: "green", state: "Clear", lastSeen: nowSec },
    "smoke-kitchen": { id: "smoke-kitchen", name: "Kitchen Smoke", kind: "smoke", room: "Kitchen", sev: "green", state: "Clear", lastSeen: nowSec },
    "leak-utility": { id: "leak-utility", name: "Utility Leak", kind: "leak", room: "Utility", sev: "yellow", state: "Moisture detected", lastSeen: nowSec },
    "camera-front": { id: "camera-front", name: "Front Camera", kind: "camera", room: "Entrance", on: true, sev: "red", state: "Person detected", lastSeen: nowSec },
    "camera-yard": { id: "camera-yard", name: "Yard Camera", kind: "camera", room: "Yard", on: true, sev: "green", state: "Armed · Recording", lastSeen: nowSec },
    "purifier": { id: "purifier", name: "Air Purifier", kind: "purifier", room: "Living Room", on: true, sev: "green", state: "On · Auto", lastSeen: nowSec },
    "curtain": { id: "curtain", name: "Bedroom Curtain", kind: "curtain", room: "Bedroom", on: false, sev: "green", state: "Closed", lastSeen: nowSec },
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

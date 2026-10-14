import { store } from "../store/store";
import type { Band } from "../contracts/ws";
import type { AlertD } from "../contracts/ws";
import type { UEvent, LanDevice, CommandEntry } from "../store/store";

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
    { id: "s1", sev: band === "PURPLE" ? "purple" : "red", title: "Suricata IDS hit", src: "suricata/eth0", body: "ET MALWARE beaconing detected on span port.", ts: nowSec - 20, ack: false },
    { id: "s2", sev: "yellow", title: "Case tripwire opened", src: "tripwire/pi3a", body: "Reed switch edge on Pi3a case lid.", ts: nowSec - 80, ack: true, ack_ts: nowSec - 60 },
    { id: "s3", sev: "yellow", title: "WiFi rogue AP", src: "wifi", body: "Unregistered AP broadcasting nearby SSID.", ts: nowSec - 140, ack: false },
    { id: "s4", sev: "info", title: "New LAN device", src: "lan", body: "Unknown MAC AA:BB:CC:DD:EE:FF joined (Espressif).", ts: nowSec - 200, ack: true, ack_ts: nowSec - 180 },
  ];

  const events: UEvent[] = [
    { id: "ev-s-1", ts: nowSec - 8, kind: "suricata", node: "pi3a", sev: band === "PURPLE" ? "purple" : "red",
      summary: "ET MALWARE beaconing on span port — sig 2024897", src_ip: "192.168.100.50", dest_ip: "45.33.32.156" },
    { id: "ev-s-2", ts: nowSec - 20, kind: "alert", node: "pi3b", sev: band === "PURPLE" ? "purple" : "red",
      summary: "Suricata IDS hit", alertId: "s1", ack: false },
    { id: "ev-s-3", ts: nowSec - 35, kind: "lan", node: "pi3a", sev: "yellow",
      summary: "Unknown device AA:BB:CC:DD:EE:FF (Espressif) · 192.168.100.50",
      derived: true, mac: "AA:BB:CC:DD:EE:FF" },
    { id: "ev-s-4", ts: nowSec - 60, kind: "tripwire", node: "pi3a", sev: "red",
      summary: "Tripwire open on pi3a", derived: true },
    { id: "ev-s-5", ts: nowSec - 80, kind: "alert", node: "pi3b", sev: "yellow",
      summary: "Case tripwire opened", alertId: "s2", ack: true, ackTs: nowSec - 60 },
    { id: "ev-s-6", ts: nowSec - 110, kind: "wifi", node: "pi3a", sev: "yellow",
      summary: "Rogue AP detected — SSID 'FreeWiFi' on ch6", mac: "11:22:33:44:55:66" },
    { id: "ev-s-7", ts: nowSec - 140, kind: "alert", node: "pi3b", sev: "yellow",
      summary: "WiFi rogue AP", alertId: "s3", ack: false },
    { id: "ev-s-8", ts: nowSec - 170, kind: "lan", node: "pi3a", sev: "info",
      summary: "Known device 00:11:22:33:44:55 (TP-Link) · 192.168.100.10",
      derived: true, mac: "00:11:22:33:44:55" },
    { id: "ev-s-9", ts: nowSec - 200, kind: "alert", node: "pi4", sev: "info",
      summary: "New LAN device", alertId: "s4", ack: true, ackTs: nowSec - 180 },
    { id: "ev-s-10", ts: nowSec - 250, kind: "band", node: "pi4", sev: band.toLowerCase(),
      summary: `Band changed to ${band}`, derived: true },
    { id: "ev-s-11", ts: nowSec - 320, kind: "suricata", node: "pi3a", sev: "yellow",
      summary: "ET SCAN potential port scan from 192.168.100.50", src_ip: "192.168.100.50" },
    { id: "ev-s-12", ts: nowSec - 400, kind: "lan", node: "pi3a", sev: "info",
      summary: "Known device CC:DD:EE:FF:00:11 (Raspberry Pi) · 192.168.100.3",
      derived: true, mac: "CC:DD:EE:FF:00:11" },
    { id: "ev-s-13", ts: nowSec - 500, kind: "tripwire", node: "pi3a", sev: "info",
      summary: "Tripwire close on pi3a", derived: true },
    { id: "ev-s-14", ts: nowSec - 600, kind: "wifi", node: "pi3a", sev: "info",
      summary: "Deauth burst detected — 12 frames in 2s", mac: "AA:BB:CC:DD:EE:FF" },
  ];

  const devices: Record<string, LanDevice> = {
    "00:11:22:33:44:55": { mac: "00:11:22:33:44:55", ip: "192.168.100.10", vendor: "TP-Link", known: true,
      firstSeen: nowSec - 86400, lastSeen: nowSec - 170 },
    "AA:BB:CC:DD:EE:FF": { mac: "AA:BB:CC:DD:EE:FF", ip: "192.168.100.50", vendor: "Espressif", known: false,
      firstSeen: nowSec - 35, lastSeen: nowSec - 35 },
    "CC:DD:EE:FF:00:11": { mac: "CC:DD:EE:FF:00:11", ip: "192.168.100.3", vendor: "Raspberry Pi", known: true,
      firstSeen: nowSec - 86400, lastSeen: nowSec - 400 },
    "11:22:33:44:55:66": { mac: "11:22:33:44:55:66", vendor: "Unknown", known: false,
      firstSeen: nowSec - 3600, lastSeen: nowSec - 110 },
    "DE:AD:BE:EF:CA:FE": { mac: "DE:AD:BE:EF:CA:FE", ip: "192.168.100.20", vendor: "Samsung", known: true,
      firstSeen: nowSec - 43200, lastSeen: nowSec - 900 },
  };

  const commandHistory: CommandEntry[] = [
    { id: "cmd-s-1", ts: Date.now() - 30000, command: "/health",
      result: "pi4: 2s ago · up 90000s\npi3a: 3s ago · up 90000s\npi3b: 5s ago · up 90000s", ok: true },
    { id: "cmd-s-2", ts: Date.now() - 120000, command: "/latency",
      result: "Last: 41ms · p95: 63ms · Clock uncertainty: 4ms", ok: true },
    { id: "cmd-s-3", ts: Date.now() - 300000, command: "/filter type:suricata",
      result: "Filter set: type:suricata", ok: true },
    { id: "cmd-s-4", ts: Date.now() - 600000, command: "/ack all",
      result: "ACK sent for 2 alerts", ok: true },
  ];

  store.seedDev({
    conn: "live", degraded: false, score, scoreTs: nowSec, band,
    history, alerts, openCount: 2, ackTotal: 4, ackDone: 2, eventCount: 37,
    events, devices, commandHistory,
    nodes: {
      pi4: { up: 90000, lastSeen: Date.now() },
      pi3a: { up: 90000, lastSeen: Date.now() },
      pi3b: { up: 90000, lastSeen: Date.now() },
    },
    layers: { idsCount: 6, idsLast: nowSec - 20, lanToday: 3, wifiRogue: true, wifiLast: nowSec - 140, tripLast: nowSec - 80, tripSeq: 1 },
    pipeline: { detect: nowSec, govern: nowSec, alert: nowSec - 20 },
    latencyLast: 41, latencyP95: 63, clockReady: true, clockUncertaintyMs: 4,
  });
}

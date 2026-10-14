// Client-side demo simulation — a paced script of synthetic envelopes that
// exercises every live panel (score/band/history, health, LAN, tripwire,
// suricata/wifi events, alerts + ACK, toasts, degraded banner) without any
// server or MQTT dependency. Pure frontend: injects straight into the store.
import type { Envelope, PayloadFor } from "../contracts/ws";
import { bandForScore } from "./bands";
import { execCommand } from "./commands";
import { store } from "../store/store";
import { transport } from "../transport/transport";

const CYCLE_MS = 92000;
const SCORE_TICK_MS = 1000;
const HEALTH_TICK_MS = 4000;

interface Beat { at: number; run: (cycle: number) => void; }

export class Simulation {
  private running = false;
  private cycle = 0;
  private alertSeq = 0;
  private target = 10;
  private score = 0;
  private silence = false;
  private startedAt = 0;
  private beatTimers: number[] = [];
  private scoreTimer = 0;
  private healthTimer = 0;

  isRunning(): boolean { return this.running; }

  private emit<T extends Envelope["t"]>(t: T, d: PayloadFor<T>): void {
    store.applyBatch([{ t, ts: Date.now() / 1000, d } as unknown as Envelope]);
  }

  private toast(msg: string, sev: string): void {
    this.emit("toast", { msg, sev });
  }

  private alert(sev: "info" | "yellow" | "red" | "purple", title: string, src: string, body: string): void {
    this.emit("alert", {
      id: `sim-${this.cycle}-${++this.alertSeq}`,
      sev, title, src, body,
      ts: Math.floor(Date.now() / 1000), ack: false,
    });
  }

  private cmd(raw: string): void { execCommand(raw); }

  private clearTimers(): void {
    for (const id of this.beatTimers) window.clearTimeout(id);
    this.beatTimers = [];
    if (this.scoreTimer) window.clearInterval(this.scoreTimer);
    if (this.healthTimer) window.clearInterval(this.healthTimer);
    this.scoreTimer = 0;
    this.healthTimer = 0;
  }

  private scorePump = (): void => {
    const diff = this.target - this.score;
    if (diff !== 0) {
      const step = Math.sign(diff) * Math.min(Math.abs(diff), Math.max(2, Math.ceil(Math.abs(diff) / 6)));
      this.score = Math.max(0, Math.min(100, this.score + step));
      this.emit("score", { v: this.score });
      const band = bandForScore(this.score);
      if (band !== store.getState().band) this.emit("band", { b: band });
    }
  };

  private healthPump = (): void => {
    const up = Math.floor((Date.now() - this.startedAt) / 1000);
    const nodes = ["pi4", "pi3a", "pi3b", "esp32"];
    for (const node of nodes) {
      if (node === "pi3a" && this.silence) continue;
      this.emit("health", { node, up });
    }
  };

  private beats(): Beat[] {
    return [
      { at: 0, run: () => {
        this.toast("Simulation started — live demo feed", "info");
        this.cmd("/health");
        this.target = 10;
      } },
      { at: 3000, run: () => {
        this.emit("lan", { mac: "00:11:22:33:44:55", ip: "192.168.100.10", vendor: "TP-Link", known: true });
      } },
      { at: 5000, run: () => this.cmd("/device 192.168.100.10") },
      { at: 7000, run: () => {
        this.emit("lan", { mac: "AA:BB:CC:DD:EE:FF", ip: "192.168.100.50", vendor: "Espressif", known: false });
        this.alert("info", "New LAN device observed", "detect/lan", "Unfamiliar MAC AA:BB:CC:DD:EE:FF · 192.168.100.50 joined the production switch");
      } },
      { at: 9000, run: () => { this.target = 22; } },
      { at: 11000, run: () => {
        this.emit("event", { topic: "voidmain/detect/suricata", node: "pi3a", kind: "suricata", sev: "yellow", summary: "ET SCAN Nmap script scan detected", src_ip: "192.168.100.50", dest_ip: "192.168.100.1", sig_id: 2010935 });
      } },
      { at: 13000, run: () => this.cmd("/latency") },
      { at: 15000, run: () => { this.target = 38; } },
      { at: 17000, run: () => {
        this.emit("event", { topic: "voidmain/detect/wifi", node: "pi3a", kind: "wifi", sev: "yellow", summary: "Rogue AP 'FREE_WIFI_5G' beaconing on channel 6" });
      } },
      { at: 19000, run: () => {
        this.emit("tripwire", { node: "pi3a", edge: "open" });
        this.alert("yellow", "Case tripwire opened", "tripwire/pi3a", "GPIO16 reed switch opened — detection node enclosure");
      } },
      { at: 23000, run: () => this.cmd("/filter type:suricata") },
      { at: 25000, run: () => {
        this.target = 64;
        this.emit("event", { topic: "voidmain/detect/suricata", node: "pi3a", kind: "suricata", sev: "red", summary: "ET TROJAN Possible Cobalt Strike C2 check-in", src_ip: "192.168.100.50", dest_ip: "185.220.101.9", sig_id: 2035007 });
        this.emit("event", { topic: "voidmain/detect/suricata", node: "pi3a", kind: "suricata", sev: "red", summary: "ET INFO Windows Executable Download From Non-Standard Port", src_ip: "192.168.100.50", dest_ip: "185.220.101.9" });
      } },
      { at: 27000, run: () => {
        this.alert("red", "Suricata IDS hit — ET MALWARE beaconing", "alert/pi3b", "Beaconing pattern from 192.168.100.50 to 185.220.101.9 — email dispatched to operator");
      } },
      { at: 29000, run: () => this.toast("Band RED — posture degraded", "red") },
      { at: 31000, run: () => this.cmd("/focus pi3a") },
      { at: 33000, run: () => {
        this.emit("tripwire", { node: "pi3b", edge: "open" });
        this.alert("yellow", "Case tripwire opened — Pi3b", "tripwire/pi3b", "GPIO17 reed switch opened — alert node enclosure");
      } },
      { at: 35000, run: () => { this.target = 88; } },
      { at: 37000, run: () => {
        this.emit("event", { topic: "voidmain/detect/suricata", node: "pi3a", kind: "suricata", sev: "purple", summary: "ET MALWARE Metasploit Payload Execution", src_ip: "192.168.100.50", dest_ip: "185.220.101.9" });
        this.alert("purple", "C2 beaconing detected", "alert/pi3b", "Sustained C2 session — PURPLE escalation envelope, operator paged");
      } },
      { at: 39000, run: () => this.toast("PURPLE — escalation envelope", "purple") },
      { at: 41000, run: () => {
        const open = store.getState().alerts.find((a) => !a.ack);
        if (open) transport.sendAck(open.id);
      } },
      { at: 43000, run: () => this.toast("MQTT DEGRADED", "yellow") },
      { at: 47000, run: () => {
        this.silence = true;
        this.alert("yellow", "Node pi3a heartbeat lost", "health/pi4", "No heartbeat from detection node for 15s — tile will age");
      } },
      { at: 51000, run: () => this.cmd("/health") },
      { at: 53000, run: () => { this.target = 55; } },
      { at: 55000, run: () => this.toast("MQTT LIVE", "info") },
      { at: 57000, run: () => this.cmd("/clear-filter") },
      { at: 63000, run: () => this.cmd("/history 6h") },
      { at: 65000, run: () => this.cmd("/latency") },
      { at: 70000, run: () => {
        for (const a of store.getState().alerts) {
          if (!a.ack) transport.sendAck(a.id);
        }
      } },
      { at: 80000, run: () => {
        this.silence = false;
        this.target = 6;
      } },
      { at: 82000, run: () => this.cmd("/focus") },
      { at: 86000, run: () => this.cmd("/help") },
      { at: 88000, run: () => this.toast("Cycle complete — restarting demo", "info") },
      { at: 91000, run: () => this.cmd("/history 24h") },
      { at: CYCLE_MS, run: (c) => {
        this.cycle = c + 1;
        this.alertSeq = 0;
        this.scheduleCycle();
      } },
    ];
  }

  private scheduleCycle(): void {
    for (const b of this.beats()) {
      this.beatTimers.push(window.setTimeout(() => {
        if (this.running) b.run(this.cycle);
      }, b.at));
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.cycle = 0;
    this.alertSeq = 0;
    this.target = 10;
    this.score = store.getState().score;
    this.silence = false;
    this.startedAt = Date.now();
    store.setSimRunning(true);
    this.healthPump();
    this.scorePump();
    this.scoreTimer = window.setInterval(this.scorePump, SCORE_TICK_MS);
    this.healthTimer = window.setInterval(this.healthPump, HEALTH_TICK_MS);
    this.scheduleCycle();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.clearTimers();
    this.silence = false;
    store.setSimRunning(false);
    this.toast("Simulation stopped", "info");
  }

  toggle(): void {
    if (this.running) this.stop();
    else this.start();
  }
}

export const simulation = new Simulation();

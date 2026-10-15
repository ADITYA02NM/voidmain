// Client-side demo simulation — a paced script of synthetic IoT envelopes that
// exercises every live panel (score/band/history, health, device grid, alerts +
// ACK, toasts, degraded banner) without any server or MQTT dependency.
// Pure frontend: injects straight into the store. Severity story:
//   GREEN normal → YELLOW unusual → RED alert → PURPLE automation → GREEN.
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

  private dev(id: string, name: string, kind: string, room: string, sev: string, state: string, extra: Record<string, unknown> = {}): void {
    this.emit("device", { id, name, kind, room, sev, state, ...extra } as never);
  }

  private seedDevices(): void {
    this.dev("door-front", "Front Door", "lock", "Entrance", "green", "Locked", { locked: true });
    this.dev("door-back", "Back Door", "lock", "Kitchen", "green", "Locked", { locked: true });
    this.dev("light-living", "Living Light", "light", "Living Room", "green", "On", { on: true });
    this.dev("light-bedroom", "Bedroom Light", "light", "Bedroom", "green", "Off", { on: false });
    this.dev("light-porch", "Porch Light", "light", "Entrance", "green", "Off", { on: false });
    this.dev("thermostat", "Thermostat", "thermostat", "Hallway", "green", "21°C · Heat");
    this.dev("garage", "Garage Door", "garage", "Garage", "green", "Closed", { locked: true });
    this.dev("plug-coffee", "Coffee Plug", "plug", "Kitchen", "green", "On", { on: true });
    this.dev("plug-desk", "Desk Plug", "plug", "Office", "green", "On", { on: true });
    this.dev("motion-hall", "Hall Motion", "motion", "Hallway", "green", "Clear");
    this.dev("motion-yard", "Yard Motion", "motion", "Yard", "green", "Clear");
    this.dev("smoke-kitchen", "Kitchen Smoke", "smoke", "Kitchen", "green", "Clear");
    this.dev("leak-utility", "Utility Leak", "leak", "Utility", "green", "Dry");
    this.dev("camera-front", "Front Camera", "camera", "Entrance", "green", "Armed · Recording", { on: true });
    this.dev("camera-yard", "Yard Camera", "camera", "Yard", "green", "Armed · Recording", { on: true });
    this.dev("purifier", "Air Purifier", "purifier", "Living Room", "green", "On · Auto", { on: true });
    this.dev("curtain", "Bedroom Curtain", "curtain", "Bedroom", "green", "Closed", { on: false });
  }

  private iotScenario(): void {
    // Phase 1 — unusual activity (YELLOW)
    this.dev("motion-yard", "Yard Motion", "motion", "Yard", "yellow", "Motion after hours");
    this.dev("motion-hall", "Hall Motion", "motion", "Hallway", "yellow", "Motion detected after hours");
    this.dev("thermostat", "Thermostat", "thermostat", "Hallway", "yellow", "24°C · Rising unexpectedly");
    this.alert("yellow", "Unusual motion detected", "iot/motion-hall", "Hall + yard motion triggered at 02:14 — no one home");
    this.toast("YELLOW — unusual activity", "yellow");
  }

  private iotAlertPhase(): void {
    // Phase 2 — red: alert sent to user
    this.dev("door-front", "Front Door", "lock", "Entrance", "red", "Opened unexpectedly", { locked: false });
    this.dev("smoke-kitchen", "Kitchen Smoke", "smoke", "Kitchen", "red", "Smoke threshold exceeded");
    this.dev("camera-front", "Front Camera", "camera", "Entrance", "red", "Person detected", { on: true });
    this.alert("red", "Intrusion alert — door + camera", "iot/door-front", "Front door opened + camera person detection. Alert dispatched to owner.");
    this.toast("RED — alerts sent to owner", "red");
    this.target = 70;
  }

  private iotAutomationPhase(): void {
    // Phase 3 — purple: automation executed
    this.dev("door-front", "Front Door", "lock", "Entrance", "purple", "Auto-locked", { locked: true, automation: "Locked door remotely" });
    this.dev("door-back", "Back Door", "lock", "Kitchen", "purple", "Auto-locked", { locked: true, automation: "Locked back door" });
    this.dev("light-living", "Living Light", "light", "Living Room", "purple", "All lights ON", { on: true, automation: "Turned on all lights" });
    this.dev("light-bedroom", "Bedroom Light", "light", "Bedroom", "purple", "All lights ON", { on: true, automation: "Turned on all lights" });
    this.dev("light-porch", "Porch Light", "light", "Entrance", "purple", "All lights ON", { on: true, automation: "Turned on porch light" });
    this.dev("camera-front", "Front Camera", "camera", "Entrance", "purple", "High-res recording", { on: true, automation: "Switched to high-res recording" });
    this.dev("camera-yard", "Yard Camera", "camera", "Yard", "purple", "High-res recording", { on: true, automation: "Switched to high-res recording" });
    this.dev("garage", "Garage Door", "garage", "Garage", "purple", "Locked", { locked: true, automation: "Garage secured" });
    this.alert("purple", "Automation executed — home secured", "iot/auto", "Doors locked, lights on, cameras high-res, garage closed.");
    this.toast("PURPLE — automation actions taken", "purple");
  }

  private iotRecoverPhase(): void {
    this.dev("door-front", "Front Door", "lock", "Entrance", "green", "Locked", { locked: true });
    this.dev("door-back", "Back Door", "lock", "Kitchen", "green", "Locked", { locked: true });
    this.dev("light-living", "Living Light", "light", "Living Room", "green", "On", { on: true });
    this.dev("light-bedroom", "Bedroom Light", "light", "Bedroom", "green", "Off", { on: false });
    this.dev("light-porch", "Porch Light", "light", "Entrance", "green", "Off", { on: false });
    this.dev("thermostat", "Thermostat", "thermostat", "Hallway", "green", "21°C · Heat");
    this.dev("garage", "Garage Door", "garage", "Garage", "green", "Closed", { locked: true });
    this.dev("motion-hall", "Hall Motion", "motion", "Hallway", "green", "Clear");
    this.dev("motion-yard", "Yard Motion", "motion", "Yard", "green", "Clear");
    this.dev("smoke-kitchen", "Kitchen Smoke", "smoke", "Kitchen", "green", "Clear");
    this.dev("camera-front", "Front Camera", "camera", "Entrance", "green", "Armed · Recording", { on: true });
    this.dev("camera-yard", "Yard Camera", "camera", "Yard", "green", "Armed · Recording", { on: true });
    this.toast("All devices normal — GREEN", "green");
  }

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
        this.toast("Simulation started — IoT demo feed", "info");
        this.cmd("/health");
        this.target = 10;
        this.seedDevices();
      } },
      { at: 3000, run: () => {
        this.dev("purifier", "Air Purifier", "purifier", "Living Room", "green", "On · Auto", { on: true });
        this.dev("curtain", "Bedroom Curtain", "curtain", "Bedroom", "green", "Closed", { on: false });
      } },
      { at: 5000, run: () => this.cmd("/latency") },
      { at: 7000, run: () => {
        this.dev("plug-coffee", "Coffee Plug", "plug", "Kitchen", "green", "On", { on: true });
        this.alert("info", "Morning routine", "iot/auto", "Coffee plug ON · purifier auto · curtain closed");
      } },
      { at: 9000, run: () => { this.target = 18; } },
      { at: 11000, run: () => {
        this.dev("motion-yard", "Yard Motion", "motion", "Yard", "yellow", "Motion detected");
        this.toast("Yard motion sensor triggered", "yellow");
      } },
      { at: 13000, run: () => {
        this.dev("thermostat", "Thermostat", "thermostat", "Hallway", "yellow", "23°C · Rising");
        this.target = 32;
      } },
      { at: 15000, run: () => {
        this.dev("leak-utility", "Utility Leak", "leak", "Utility", "yellow", "Moisture detected");
        this.alert("yellow", "Water leak under sink", "iot/leak-utility", "Moisture sensor triggered — utility room. Check plumbing.");
      } },
      { at: 17000, run: () => {
        this.dev("motion-hall", "Hall Motion", "motion", "Hallway", "yellow", "Motion after hours");
        this.dev("camera-yard", "Yard Camera", "camera", "Yard", "yellow", "Motion clip saved", { on: true });
      } },
      { at: 21000, run: () => this.iotScenario() },
      { at: 23000, run: () => this.cmd("/filter type:device") },
      { at: 25000, run: () => {
        this.target = 58;
        this.dev("door-back", "Back Door", "lock", "Kitchen", "red", "Opened unexpectedly", { locked: false });
        this.dev("camera-yard", "Yard Camera", "camera", "Yard", "red", "Person detected", { on: true });
      } },
      { at: 27000, run: () => {
        this.alert("red", "Intrusion alert — door + camera", "iot/door-front", "Front door opened + camera person detection. Alert dispatched to owner.");
        this.iotAlertPhase();
      } },
      { at: 29000, run: () => this.toast("Band RED — posture degraded", "red") },
      { at: 31000, run: () => this.cmd("/focus pi4") },
      { at: 33000, run: () => {
        this.dev("smoke-kitchen", "Kitchen Smoke", "smoke", "Kitchen", "red", "Smoke rising");
        this.alert("red", "Kitchen smoke rising", "iot/smoke-kitchen", "Smoke density climbing — HVAC boosted, alerts paged.");
      } },
      { at: 35000, run: () => { this.target = 88; } },
      { at: 37000, run: () => {
        this.alert("purple", "Automation armed", "iot/auto", "Multi-sensor fusion: motion + door + camera → secure-home playbook.");
      } },
      { at: 39000, run: () => {
        this.toast("PURPLE — escalation envelope", "purple");
        this.iotAutomationPhase();
      } },
      { at: 41000, run: () => {
        const open = store.getState().alerts.find((a) => !a.ack);
        if (open) transport.sendAck(open.id);
      } },
      { at: 43000, run: () => this.toast("MQTT DEGRADED", "yellow") },
      { at: 47000, run: () => {
        this.silence = true;
        this.alert("yellow", "Node pi3a heartbeat lost", "health/pi4", "No heartbeat from sensor node for 15s — tile will age");
      } },
      { at: 51000, run: () => this.cmd("/health") },
      { at: 53000, run: () => { this.target = 55; } },
      { at: 55000, run: () => this.toast("MQTT LIVE", "info") },
      { at: 57000, run: () => this.cmd("/clear-filter") },
      { at: 60000, run: () => this.iotRecoverPhase() },
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

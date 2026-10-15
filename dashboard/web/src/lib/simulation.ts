// Client-side demo simulation — a paced script of synthetic IoT envelopes that
// exercises every live panel (score/band/history, health, device grid, alerts +
// ACK, toasts, degraded banner) without any server or MQTT dependency.
// Pure frontend: injects straight into the store. Severity story:
//   GREEN normal → YELLOW unusual → RED alert → PURPLE automation → GREEN.
//
// With the stack up (WS open) the tour runs ON THE BUS instead: start() relays
// {sim:"start"} to the server, which publishes voidmain/sim/start and the dev
// feed (tools/mock_feed.py) replays the scenario on MQTT — so the dashboard and
// the ESP32 OLED change together. The local beat script below remains as the
// offline fallback for a browser with no backend.
import type { Envelope, PayloadFor } from "../contracts/ws";
import { bandForScore } from "./bands";
import { execCommand } from "./commands";
import { store } from "../store/store";
import { transport } from "../transport/transport";

const CYCLE_MS = 60000;
const SCORE_TICK_MS = 1000;
const HEALTH_TICK_MS = 4000;

interface Beat { at: number; run: (cycle: number) => void; }

export class Simulation {
  private running = false;
  private busBacked = false;
  private cycle = 0;
  private alertSeq = 0;
  private target = 10;
  private score = 0;
  private silence = false;
  private chaos = false;
  private startedAt = 0;
  private beatTimers: number[] = [];
  private scoreTimer = 0;
  private healthTimer = 0;
  private chaosTimer = 0;
  private reconnectTimer = 0;

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
    this.dev("smoke-detector", "Smoke Detector", "smoke", "Kitchen", "green", "Clear");
    this.dev("campfire", "Campfire", "extinguish", "Backyard", "green", "Burning", { burning: true });
    this.dev("air-purifier", "Air Purifier", "purifier", "Living Room", "green", "On auto", { on: true });
    this.dev("door-front", "Front Door", "lock", "Entrance", "green", "Locked", { locked: true });
    this.dev("camera-front", "Front Camera", "camera", "Entrance", "green", "Armed recording", { on: true });
    this.dev("perimeter", "Perimeter Sensor", "perimeter", "Yard", "green", "Clear");
  }

  private clearTimers(): void {
    for (const id of this.beatTimers) clearTimeout(id);
    this.beatTimers = [];
    if (this.scoreTimer) clearInterval(this.scoreTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.chaosTimer) clearInterval(this.chaosTimer);
    this.scoreTimer = 0;
    this.healthTimer = 0;
    this.chaosTimer = 0;
  }

  private flash(msg: string, sev: string, big?: boolean): void {
    this.toast(msg, sev);
    if (big) {
      // extra punch: queue another toast right after for a quick double-hit
      setTimeout(() => this.toast(`+ ${sev.toUpperCase()}`, sev), 220);
    }
  }


  private scorePump = (): void => {
    // Bouncy score: ease the score toward target with a little overshoot so
    // the number and band feel alive instead of stair-stepping.
    const diff = this.target - this.score;
    if (diff !== 0) {
      const abs = Math.abs(diff);
      const step = Math.sign(diff) * Math.min(abs, Math.max(3, Math.ceil(abs / 5)));
      this.score = Math.max(0, Math.min(100, this.score + step));
      this.emit("score", { v: this.score });
      const band = bandForScore(this.score);
      if (band !== store.getState().band) this.emit("band", { b: band });
      // small score-only jumps for liveliness even when target is steady
      if (abs < 4 && Math.random() < 0.25) {
        const jitter = Math.round(Math.random() * 6 - 3);
        const next = Math.max(0, Math.min(100, this.score + jitter));
        this.emit("score", { v: next });
        if (bandForScore(next) !== store.getState().band) {
          this.emit("band", { b: bandForScore(next) });
        }
      }
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

  private chaosPump = (): void => {
    if (!this.chaos) return;
    // rapid fun: random device flips, random score pokes, random toasts.
    const dev = store.getState().iot;
    const ids = Object.keys(dev);
    if (ids.length) {
      const id = ids[Math.floor(Math.random() * ids.length)];
      const sev = ["green", "yellow", "red", "purple"][Math.floor(Math.random() * 4)];
      const row = dev[id];
      const states: Record<string, string> = {
        lock: sev === "green" ? "Locked" : sev === "yellow" ? "Ajar" : sev === "red" ? "Opened unexpectedly" : "Auto-locked",
        camera: sev === "green" ? "Armed recording" : sev === "yellow" ? "Motion clip saved" : sev === "red" ? "Person detected" : "High-res recording",
        purifier: sev === "green" ? "On auto" : sev === "yellow" ? "Filter low" : sev === "red" ? "Off" : "Boosted",
        extinguish: sev === "green" ? "Burning" : sev === "yellow" ? "Waning" : sev === "red" ? "Smoldering" : "Extinguished",
        motion: sev === "green" ? "Clear" : sev === "yellow" ? "Motion after hours" : sev === "red" ? "Person detected" : "Cleared",
        smoke: sev === "green" ? "Clear" : sev === "yellow" ? "Smoke sensed" : sev === "red" ? "Smoke alarm" : "HVAC boost",
      };
      const state = states[row?.kind as keyof typeof states] || "OK";
      const extra: Record<string, unknown> = {};
      if (sev === "purple") extra.automation = "Automation triggered";
      if (row?.kind === "lock") extra.locked = sev === "green" || sev === "purple";
      if (row?.kind === "camera" || row?.kind === "purifier") extra.on = sev !== "red";
      if (row?.kind === "extinguish") extra.burning = sev === "green" || sev === "yellow";
      this.dev(id, row?.name || id, row?.kind || "sensor", row?.room || "—", sev, state, extra);
    }
    // occasional score poke
    if (Math.random() < 0.4) {
      const jump = Math.round(Math.random() * 16 - 8);
      this.target = Math.max(0, Math.min(100, this.target + jump));
    }
    // occasional funny toast
    if (Math.random() < 0.3) {
      const msgs = [
        ["Chaos mode", "yellow"], ["Sensor funny", "info"], ["Something moved", "yellow"],
        ["Auto-reacting", "purple"], ["Re-evaluating…", "info"], ["Still watching", "green"],
      ];
      const [msg, sev] = msgs[Math.floor(Math.random() * msgs.length)];
      this.toast(msg, sev);
    }
  };

  private beats(): Beat[] {
    return [
      // ---- [0:00 - 0:08] GREEN baseline (8s) ----
      { at: 0, run: () => {
        this.toast("Simulation started — monitoring facility baseline", "info");
        this.cmd("/health");
        this.target = 6;
        this.chaos = false;
        this.seedDevices();
      } },
      { at: 2000, run: () => {
        this.flash("GREEN baseline — all systems nominal", "green", true);
      } },
      { at: 4000, run: () => this.cmd("/latency") },

      // ---- [0:08 - 0:20] YELLOW Anomaly Stage (12s) ----
      { at: 8000, run: () => {
        this.dev("perimeter", "Perimeter Sensor", "perimeter", "Yard", "yellow", "Motion after hours (02:14 AM)");
        this.toast("Perimeter tripwire active (02:14 AM)", "yellow");
      } },
      { at: 10000, run: () => {
        this.dev("air-purifier", "Air Purifier", "purifier", "Living Room", "yellow", "Particulate spike / Filter warning", { on: true });
      } },
      { at: 11500, run: () => {
        this.dev("smoke-detector", "Smoke Detector", "smoke", "Kitchen", "yellow", "Haze detected in kitchen");
      } },
      { at: 12500, run: () => {
        this.alert("yellow", "Unusual activity — perimeter motion + environmental drift", "iot/perimeter-yard", "Perimeter tripwire triggered at 02:14. Air purifier and smoke detector report early haze.");
        this.target = 45;
        this.flash("Score climbing — unusual activity", "yellow");
      } },
      { at: 16000, run: () => {
        this.flash("YELLOW settled — review recommended", "yellow", true);
      } },

      // ---- [0:20 - 0:36] RED Intrusion Peak Stage (16s) ----
      { at: 20000, run: () => {
        this.dev("perimeter", "Perimeter Sensor", "perimeter", "Yard", "red", "Perimeter breached");
        this.flash("Intrusion pattern developing", "red");
      } },
      { at: 21500, run: () => {
        this.dev("door-front", "Front Door", "lock", "Entrance", "red", "Opened unexpectedly", { locked: false });
      } },
      { at: 22500, run: () => {
        this.dev("camera-front", "Front Camera", "camera", "Entrance", "red", "Person detected", { on: true });
      } },
      { at: 23500, run: () => {
        this.dev("campfire", "Campfire", "extinguish", "Backyard", "red", "Smoldering unattended", { burning: true });
      } },
      { at: 24500, run: () => {
        this.dev("smoke-detector", "Smoke Detector", "smoke", "Kitchen", "red", "Smoke alarm sounding");
      } },
      { at: 25500, run: () => {
        this.alert("red", "CRITICAL Intrusion — perimeter breached, front door forced, person detected", "iot/door-front", "Front door opened unexpectedly, camera detected unauthorized person, perimeter breached, kitchen smoke alarm sounding. Dispatched alert to Elena Vance.");
        this.target = 78;
        this.flash("RED peak — intrusion detected", "red", true);
      } },
      { at: 30000, run: () => this.cmd("/filter type:device") },
      { at: 32000, run: () => this.cmd("/focus pi4") },

      // ---- [0:36 - 0:50] PURPLE Autonomous Lockdown Stage (14s) ----
      { at: 36000, run: () => {
        this.dev("door-front", "Front Door", "lock", "Entrance", "purple", "Auto-locked", { locked: true, automation: "Autonomous remote deadbolt engaged" });
        this.flash("Door auto-locked in 180ms", "purple");
      } },
      { at: 37000, run: () => {
        this.dev("camera-front", "Front Camera", "camera", "Entrance", "purple", "High-res recording", { on: true, automation: "Camera switched to 4K evidence capture" });
      } },
      { at: 38000, run: () => {
        this.dev("air-purifier", "Air Purifier", "purifier", "Living Room", "purple", "Boosted", { on: true, automation: "Air scrubber overdrive engaged" });
      } },
      { at: 39000, run: () => {
        this.dev("campfire", "Campfire", "extinguish", "Backyard", "purple", "Extinguished", { burning: false, automation: "Sprinkler automation extinguished fire" });
      } },
      { at: 40000, run: () => {
        this.dev("perimeter", "Perimeter Sensor", "perimeter", "Yard", "purple", "Perimeter secured", { automation: "Zone isolation active" });
        this.dev("smoke-detector", "Smoke Detector", "smoke", "Kitchen", "purple", "Suppression active", { automation: "Halon / mist suppression active" });
      } },
      { at: 42000, run: () => {
        this.alert("purple", "Autonomous policy executed — home secured in 180ms", "iot/auto", "Door locked remotely, 4K camera engaged, air purifier boosted, fire suppressed, perimeter isolated. False alarm probability: 0.02%.");
        this.target = 92;
        this.flash("PURPLE — home secured in 180ms", "purple", true);
      } },
      { at: 46000, run: () => this.cmd("/clear-filter") },

      // ---- [0:50 - 1:00] Smooth Decay & Recovery (10s) ----
      { at: 50000, run: () => {
        this.target = 6;
        this.flash("Pulling back — posture recovering", "green");
      } },
      { at: 55000, run: () => {
        this.dev("door-front", "Front Door", "lock", "Entrance", "green", "Locked", { locked: true });
        this.dev("camera-front", "Front Camera", "camera", "Entrance", "green", "Armed recording", { on: true });
        this.dev("air-purifier", "Air Purifier", "purifier", "Living Room", "green", "On auto", { on: true });
        this.dev("campfire", "Campfire", "extinguish", "Backyard", "green", "Burning", { burning: true });
        this.dev("perimeter", "Perimeter Sensor", "perimeter", "Yard", "green", "Clear");
        this.dev("smoke-detector", "Smoke Detector", "smoke", "Kitchen", "green", "Clear");
        for (const a of store.getState().alerts) {
          if (!a.ack) transport.sendAck(a.id);
        }
        this.flash("All devices normal — GREEN recovery", "green", true);
      } },

      // ---- restart the 60s continuous loop ----
      { at: CYCLE_MS, run: (c) => {
        this.cycle = c + 1;
        this.alertSeq = 0;
        this.scheduleCycle();
      } },
    ];
  }

  private scheduleCycle(): void {
    for (const b of this.beats()) {
      this.beatTimers.push(setTimeout(() => {
        if (this.running) b.run(this.cycle);
      }, b.at) as unknown as number);
    }
  }

  start(): void {
    if (this.running) {
      if (store.getState().simPaused) {
        this.resume();
      }
      return;
    }
    this.running = true;
    this.busBacked = false;
    this.cycle = 0;
    this.alertSeq = 0;
    this.target = 6;
    this.score = store.getState().score || 6;
    this.silence = false;
    this.chaos = false;
    this.startedAt = Date.now();
    store.setSimRunning(true);
    store.setSimPaused(false);
    if (transport.live) {
      this.busBacked = true;
      transport.sendSim("start");
      this.toast("SIM TOUR started on bus — dashboard + ESP32 in sync", "info");
      this.startReconnectWatch();
      return;
    }
    this.runLocal();
  }

  pause(): void {
    if (!this.running || store.getState().simPaused) return;
    store.setSimPaused(true);
    if (transport.live) transport.sendSim("pause");
    this.toast("Simulation paused / held — graphs live", "yellow");
  }

  resume(): void {
    if (!this.running || !store.getState().simPaused) return;
    store.setSimPaused(false);
    if (transport.live) transport.sendSim("resume");
    this.toast("Simulation resumed", "green");
  }

  reset(): void {
    this.running = false;
    this.clearTimers();
    this.stopReconnectWatch();
    this.silence = false;
    this.chaos = false;
    store.resetSimState();
    if (transport.live) transport.sendSim("reset");
    this.toast("Simulation reset to baseline", "info");
  }

  private startReconnectWatch(): void {
    this.clearTimers();
    this.reconnectTimer = setInterval(() => {
      if (!this.running) { this.stopReconnectWatch(); return; }
      if (transport.live) {
        // still bus-backed, keep watching
      } else {
        // bus went down mid-tour — fall back to local simulation
        this.toast("Bus down — switching to local simulation", "yellow");
        this.runLocal();
        this.stopReconnectWatch();
      }
    }, 2000) as unknown as number;
  }

  private stopReconnectWatch(): void {
    if (this.reconnectTimer) { clearInterval(this.reconnectTimer); this.reconnectTimer = 0; }
  }

  private runLocal(): void {
    this.busBacked = false;
    this.clearTimers();
    this.healthPump();
    this.scorePump();
    this.scoreTimer = setInterval(this.scorePump, SCORE_TICK_MS) as unknown as number;
    this.healthTimer = setInterval(this.healthPump, HEALTH_TICK_MS) as unknown as number;
    this.chaosTimer = setInterval(this.chaosPump, 900) as unknown as number;
    this.scheduleCycle();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.clearTimers();
    this.stopReconnectWatch();
    this.silence = false;
    this.chaos = false;
    store.setSimRunning(false);
    store.setSimPaused(false);
    if (transport.live) transport.sendSim("stop");
    this.toast("Simulation stopped", "info");
  }

  /** Enable extra liveliness: rapid sensor flips, random score pokes, rainbow-ish toasts. */
  setChaos(on: boolean): void {
    this.chaos = on;
    this.toast(on ? "Chaos on — sensors jumping" : "Chaos off — calm", on ? "yellow" : "green");
  }

  toggle(): void {
    if (this.running) this.stop();
    else this.start();
  }

  /** Call when WS reconnects so a bus-backed tour can resume driving from the bus. */
  onWsLive(): void {
    if (!this.running) return;
    if (this.busBacked) return; // already bus-backed
    this.stopReconnectWatch();
    this.clearTimers();
    this.busBacked = true;
    this.toast("Bus restored — simulation now bus-backed", "green");
  }

  /** Call when WS drops so we fall back to local simulation. */
  onWsOffline(): void {
    if (!this.running) return;
    if (!this.busBacked) return; // already local
    this.stopReconnectWatch();
    this.toast("Bus lost — switching to local simulation", "yellow");
    this.runLocal();
  }
}

export const simulation = new Simulation();

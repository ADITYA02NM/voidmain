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

const CYCLE_MS = 92000;
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
  private hue = 0;
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

  private poke(scoreJump?: number, sev?: string): void {
    if (scoreJump != null) {
      this.target = Math.max(0, Math.min(100, this.target + scoreJump));
    }
    if (sev) this.toast(`poke → ${sev}`, sev);
  }

  private seedDevices(): void {
    this.dev("campfire", "Campfire", "extinguish", "Backyard", "green", "Burning", { burning: true });
    this.dev("air-purifier", "Air Purifier", "purifier", "Living Room", "green", "On auto", { on: true });
    this.dev("door-front", "Front Door", "lock", "Entrance", "green", "Locked", { locked: true });
    this.dev("camera-front", "Front Camera", "camera", "Entrance", "green", "Armed recording", { on: true });
    this.dev("motion-yard", "Yard Motion", "motion", "Yard", "green", "Clear");
  }

  private iotScenario(): void {
    this.dev("motion-yard", "Yard Motion", "motion", "Yard", "yellow", "Motion after hours");
    this.alert("yellow", "Unusual motion detected", "iot/motion-yard", "Yard motion triggered — no one home");
    this.toast("YELLOW — unusual activity", "yellow");
  }

  private iotAlertPhase(): void {
    this.dev("door-front", "Front Door", "lock", "Entrance", "red", "Opened unexpectedly", { locked: false });
    this.dev("camera-front", "Front Camera", "camera", "Entrance", "red", "Person detected", { on: true });
    this.dev("campfire", "Campfire", "extinguish", "Backyard", "red", "Smoldering");
    this.alert("red", "Intrusion alert — door + camera", "iot/door-front", "Front door opened + camera person detection. Alert dispatched to owner.");
    this.toast("RED — alerts sent to owner", "red");
    this.target = 70;
  }

  private iotAutomationPhase(): void {
    this.dev("door-front", "Front Door", "lock", "Entrance", "purple", "Auto-locked", { locked: true, automation: "Door locked remotely" });
    this.dev("camera-front", "Front Camera", "camera", "Entrance", "purple", "High-res recording", { on: true, automation: "Camera switched to high-res" });
    this.dev("air-purifier", "Air Purifier", "purifier", "Living Room", "purple", "Boosted", { on: true, automation: "Air purifier boosted" });
    this.dev("campfire", "Campfire", "extinguish", "Backyard", "purple", "Extinguished", { burning: false, automation: "Campfire extinguished by automation" });
    this.alert("purple", "Automation executed — home secured", "iot/auto", "Doors locked, cameras high-res, air purifier boosted, campfire extinguished.");
    this.toast("PURPLE — automation actions taken", "purple");
  }

  private iotRecoverPhase(): void {
    this.dev("door-front", "Front Door", "lock", "Entrance", "green", "Locked", { locked: true });
    this.dev("camera-front", "Front Camera", "camera", "Entrance", "green", "Armed recording", { on: true });
    this.dev("air-purifier", "Air Purifier", "purifier", "Living Room", "green", "On auto", { on: true });
    this.dev("campfire", "Campfire", "extinguish", "Backyard", "green", "Burning", { burning: true });
    this.dev("motion-yard", "Yard Motion", "motion", "Yard", "green", "Clear");
  }

  private clearTimers(): void {
    for (const id of this.beatTimers) window.clearTimeout(id);
    this.beatTimers = [];
    if (this.scoreTimer) window.clearInterval(this.scoreTimer);
    if (this.healthTimer) window.clearInterval(this.healthTimer);
    if (this.chaosTimer) window.clearInterval(this.chaosTimer);
    this.scoreTimer = 0;
    this.healthTimer = 0;
    this.chaosTimer = 0;
  }

  private rainbow(): string {
    this.hue = (this.hue + 3) % 360;
    const h = this.hue;
    return `hsl(${h},85%,62%)`;
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
      // ---- boot: big splash ----
      { at: 0, run: () => {
        this.toast("Simulation started — let's make some noise", "info");
        this.cmd("/health");
        this.target = 10;
        this.chaos = false;
        this.seedDevices();
        // rainbow intro toasts
        [", sensors warm", ", devices ready", ", watching…"].forEach((s, i) =>
          setTimeout(() => this.toast("hello" + s, "green"), i * 260));
      } },
      { at: 2000, run: () => {
        this.flash("GREEN baseline", "green", true);
      } },
      { at: 4000, run: () => this.cmd("/latency") },

      // ---- YELLOW ramp: fast, jittery ----
      { at: 10000, run: () => {
        this.dev("motion-yard", "Yard Motion", "motion", "Yard", "yellow", "Motion detected");
        this.toast("Yard motion", "yellow");
        this.target = 32;
      } },
      { at: 12000, run: () => {
        this.target = 46;
        this.flash("Score climbing — unusual activity", "yellow");
      } },
      { at: 14000, run: () => {
        this.alert("yellow", "Unusual activity — multiple sensors", "iot/motion-yard", "Yard motion and environmental sensors triggered outside the learned schedule.");
        this.poke(6, "yellow");
      } },
      { at: 16000, run: () => {
        this.flash("Multiple sensors — review recommended", "yellow");
      } },
      { at: 18500, run: () => {
        this.target = 58;
        this.flash("YELLOW settled — review recommended", "yellow", true);
      } },

      // ---- RED spike: sudden jumps ----
      { at: 20000, run: () => {
        this.target = 58;
        this.flash("Intrusion pattern developing", "red");
      } },
      { at: 21500, run: () => {
        this.target = 70;
        this.dev("door-front", "Front Door", "lock", "Entrance", "red", "Opened unexpectedly", { locked: false });
        this.dev("camera-front", "Front Camera", "camera", "Entrance", "red", "Person detected", { on: true });
        this.dev("campfire", "Campfire", "extinguish", "Backyard", "red", "Smoldering");
        this.alert("red", "Intrusion alert — door + camera", "iot/door-front", "Front door opened + camera person detection. Alert dispatched to owner.");
        this.flash("RED — alerts sent to owner", "red", true);
      } },
      { at: 23500, run: () => {
        this.target = 82;
        this.flash("Score jumping — severe", "red");
      } },
      { at: 25000, run: () => this.cmd("/filter type:device") },
      { at: 26500, run: () => this.cmd("/focus pi4") },
      { at: 28000, run: () => {
        this.target = 92;
        this.flash("RED peak — posture degraded", "red", true);
      } },

      // ---- PURPLE swing: automation barrage ----
      { at: 30000, run: () => {
        this.target = 92;
        this.alert("purple", "Automation armed", "iot/auto", "Multi-sensor fusion: motion + door + camera → secure-home playbook.");
        this.flash("Automation playbook firing", "purple");
      } },
      { at: 31500, run: () => {
        this.dev("door-front", "Front Door", "lock", "Entrance", "purple", "Auto-locked", { locked: true, automation: "Door locked remotely" });
        this.flash("Door locked", "purple");
      } },
      { at: 34500, run: () => {
        this.dev("camera-front", "Front Camera", "camera", "Entrance", "purple", "High-res recording", { on: true, automation: "Camera switched to high-res" });
        this.flash("Camera high-res", "purple");
      } },
      { at: 36000, run: () => {
        this.dev("air-purifier", "Air Purifier", "purifier", "Living Room", "purple", "Boosted", { on: true, automation: "Air purifier boosted" });
        this.dev("campfire", "Campfire", "extinguish", "Backyard", "purple", "Extinguished", { burning: false, automation: "Campfire extinguished by automation" });
        this.alert("purple", "Automation executed — home secured", "iot/auto", "Door locked, camera high-res, air purifier boosted, campfire extinguished.");
        this.flash("PURPLE — home secured", "purple", true);
      } },
      { at: 38000, run: () => this.cmd("/clear-filter") },

      // ---- ACK the open alerts ----
      { at: 39500, run: () => {
        const open = store.getState().alerts.find((a) => !a.ack);
        if (open) transport.sendAck(open.id);
        this.toast("ACK — alert acknowledged", "green");
      } },

      // ---- chaos window: fast, fun, bouncy ----
      { at: 41000, run: () => {
        this.chaos = true;
        this.flash("CHAOS — rapid sensor flips", "yellow");
      } },
      { at: 43000, run: () => this.toast("MQTT DEGRADED", "yellow") },
      { at: 45000, run: () => this.toast("MQTT LIVE", "green") },
      { at: 47000, run: () => {
        this.silence = true;
        this.alert("yellow", "Node pi3a heartbeat lost", "health/pi4", "No heartbeat from sensor node — tile will age.");
        this.flash("pi3a silent", "yellow");
      } },
      { at: 49000, run: () => this.cmd("/health") },

      // ---- pull back: dramatic decay ----
      { at: 51000, run: () => {
        this.target = 55;
        this.flash("Pulling back — score easing", "yellow");
      } },
      { at: 54000, run: () => {
        this.target = 30;
        this.flash("Yellow → green transition", "green");
      } },
      { at: 57000, run: () => {
        this.chaos = false;
        this.silence = false;
        this.target = 12;
        this.flash("Calm restored", "green", true);
      } },

      // ---- GREEN recovery: full settle ----
      { at: 60000, run: () => {
        this.iotRecoverPhase();
        this.flash("All devices normal — GREEN", "green", true);
      } },
      { at: 63000, run: () => this.cmd("/history 6h") },
      { at: 65000, run: () => this.cmd("/latency") },
      { at: 67000, run: () => {
        for (const a of store.getState().alerts) {
          if (!a.ack) transport.sendAck(a.id);
        }
        this.toast("All alerts acknowledged", "green");
      } },
      { at: 70000, run: () => this.cmd("/focus") },
      { at: 73000, run: () => this.cmd("/help") },
      { at: 76000, run: () => {
        this.target = 5;
        this.flash("Cycle complete — resting at GREEN", "green");
      } },
      { at: 80000, run: () => this.cmd("/history 24h") },

      // ---- restart the fun ----
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
    this.busBacked = false;
    this.cycle = 0;
    this.alertSeq = 0;
    this.target = 10;
    this.score = store.getState().score;
    this.silence = false;
    this.chaos = false;
    this.startedAt = Date.now();
    store.setSimRunning(true);
    if (transport.live) {
      // Bus-backed tour: every envelope arrives from MQTT, exactly what the
      // ESP32 panel renders. No local pumps, no beats.
      this.busBacked = true;
      transport.sendSim("start");
      this.toast("SIM TOUR on the bus — dashboard + ESP32 in sync", "info");
      this.startReconnectWatch();
      return;
    }
    this.runLocal();
  }

  private startReconnectWatch(): void {
    this.clearTimers();
    this.reconnectTimer = window.setInterval(() => {
      if (!this.running) { this.stopReconnectWatch(); return; }
      if (transport.live) {
        // still bus-backed, keep watching
      } else {
        // bus went down mid-tour — fall back to local simulation
        this.toast("Bus down — switching to local simulation", "yellow");
        this.runLocal();
        this.stopReconnectWatch();
      }
    }, 2000);
  }

  private stopReconnectWatch(): void {
    if (this.reconnectTimer) { window.clearInterval(this.reconnectTimer); this.reconnectTimer = 0; }
  }

  private runLocal(): void {
    this.busBacked = false;
    this.clearTimers();
    this.healthPump();
    this.scorePump();
    this.scoreTimer = window.setInterval(this.scorePump, SCORE_TICK_MS);
    this.healthTimer = window.setInterval(this.healthPump, HEALTH_TICK_MS);
    this.chaosTimer = window.setInterval(this.chaosPump, 900);
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

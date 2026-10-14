import { store } from "../store/store";
import type { CommandEntry } from "../store/store";
import { transport } from "../transport/transport";
import { logout } from "./auth";
import { simulation } from "./simulation";

export interface CommandDef {
  name: string;
  args?: string;
  desc: string;
  phase2?: boolean;
  serverSide?: boolean;
}

export const COMMANDS: CommandDef[] = [
  { name: "help", desc: "List commands with args" },
  { name: "filter", args: "<sev:x src:x type:x>", desc: "Filter the events panel" },
  { name: "clear-filter", desc: "Reset event filters" },
  { name: "focus", args: "<pi4|pi3a|pi3b|c3|wroom>", desc: "Highlight a node in the device map" },
  { name: "device", args: "<ip|mac>", desc: "Open a device card in the IoT graph" },
  { name: "history", args: "<1h|6h|24h>", desc: "Change the chart range" },
  { name: "simulate", args: "[stop]", desc: "Run the client-side demo simulation" },
  { name: "latency", desc: "Print latency stats" },
  { name: "health", desc: "Print per-node heartbeat ages" },
  { name: "mute", args: "<minutes>", desc: "Mute toasts" },
  { name: "export", args: "alerts", desc: "Browser-side CSV of alerts" },
  { name: "ack", args: "<id|all>", desc: "Acknowledge alert(s)", serverSide: true },
  { name: "lock", desc: "End the session", serverSide: true },
  { name: "devices", desc: "List registered passkeys", serverSide: true },
  { name: "block", desc: "Block a device", phase2: true },
  { name: "isolate", desc: "Isolate a segment", phase2: true },
  { name: "quarantine", desc: "Quarantine a host", phase2: true },
  { name: "restart", desc: "Restart a service", phase2: true },
  { name: "scan", desc: "Scan network", phase2: true },
];

export const QUICK_CMDS = [
  { label: "ACK ALL", cmd: "/ack all" },
  { label: "UNACKED", cmd: "/filter type:unacked" },
  { label: "FOCUS NODE", cmd: "/focus pi3a" },
  { label: "SIMULATE", cmd: "/simulate" },
  { label: "EXPORT CSV", cmd: "/export alerts" },
  { label: "LOCK", cmd: "/lock" },
];

let _cmdId = 0;

function entry(command: string, result: string, ok: boolean): CommandEntry {
  return { id: `cmd-${++_cmdId}`, ts: Date.now(), command, result, ok };
}

function handleServerCommand(name: string, args: string, raw: string): void {
  switch (name) {
    case "ack": {
      if (args === "all") {
        const s = store.getState();
        const unacked = s.alerts.filter((a) => !a.ack);
        if (!unacked.length) {
          store.addCommand(entry(raw, "No unacknowledged alerts", true));
          return;
        }
        for (const a of unacked) transport.sendAck(a.id);
        store.addCommand(entry(raw, `ACK sent for ${unacked.length} alerts`, true));
      } else if (args) {
        transport.sendAck(args);
        store.addCommand(entry(raw, `ACK sent: ${args}`, true));
      } else {
        store.addCommand(entry(raw, "Usage: /ack <id|all>", false));
      }
      break;
    }
    case "lock": {
      transport.stop();
      logout();
      store.addCommand(entry(raw, "Session ended", true));
      break;
    }
    case "devices": {
      store.setShowDevices(true);
      store.addCommand(entry(raw, "Opened devices panel", true));
      break;
    }
    default:
      store.addCommand(entry(raw, `Server command not implemented: /${name}`, false));
  }
}

export function execCommand(raw: string): void {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) {
    store.addCommand(entry(trimmed, "Commands must start with /", false));
    return;
  }
  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase() ?? "";
  const args = parts.slice(1).join(" ");
  const def = COMMANDS.find((c) => c.name === name);

  if (!def) {
    store.addCommand(entry(trimmed, `Unknown command: /${name}`, false));
    return;
  }
  if (def.phase2) {
    store.addCommand(entry(trimmed, "Response actions are Phase 2 — notify-only in Phase 1", false));
    return;
  }
  if (def.serverSide) {
    if (store.getState().authPhase !== "ready") {
      store.addCommand(entry(trimmed, "Requires authentication — sign in first", false));
      return;
    }
    handleServerCommand(name, args, trimmed);
    return;
  }

  switch (name) {
    case "help": {
      const lines = COMMANDS.map((c) => {
        const a = c.args ? ` ${c.args}` : "";
        const tag = c.phase2 ? " [Phase 2]" : c.serverSide ? " [auth]" : "";
        return `/${c.name}${a} — ${c.desc}${tag}`;
      });
      store.addCommand(entry(trimmed, lines.join("\n"), true));
      break;
    }
    case "filter": {
      const filter = args || "all";
      store.setEventFilter(filter);
      store.addCommand(entry(trimmed, `Filter set: ${filter}`, true));
      break;
    }
    case "clear-filter": {
      store.setEventFilter("all");
      store.addCommand(entry(trimmed, "Filters cleared", true));
      break;
    }
    case "focus": {
      const node = args.toLowerCase() || null;
      const valid = ["pi4", "pi3a", "pi3b", "c3", "wroom"];
      if (node && !valid.includes(node)) {
        store.addCommand(entry(trimmed, `Unknown node: ${node}. Valid: ${valid.join(", ")}`, false));
      } else {
        store.setFocusNode(node);
        store.addCommand(entry(trimmed, node ? `Focused on ${node}` : "Focus cleared", true));
      }
      break;
    }
    case "simulate": {
      if (args === "stop") {
        simulation.stop();
        store.addCommand(entry(trimmed, "Simulation stopped", true));
      } else if (store.getState().simRunning) {
        simulation.stop();
        store.addCommand(entry(trimmed, "Simulation stopped", true));
      } else {
        simulation.start();
        store.addCommand(entry(trimmed, "Simulation running — client-side demo feed", true));
      }
      break;
    }
    case "latency": {
      const s = store.getState();
      store.addCommand(entry(trimmed,
        `Last: ${s.latencyLast}ms · p95: ${s.latencyP95}ms · Clock uncertainty: ${Math.round(s.clockUncertaintyMs)}ms`, true));
      break;
    }
    case "health": {
      const s = store.getState();
      const nodes = Object.entries(s.nodes);
      if (!nodes.length) {
        store.addCommand(entry(trimmed, "No heartbeats received", false));
      } else {
        const lines = nodes.map(([id, n]) => {
          const age = Math.round((Date.now() - n.lastSeen) / 1000);
          return `${id}: ${age}s ago${n.up != null ? ` · up ${Math.round(n.up)}s` : ""}`;
        });
        store.addCommand(entry(trimmed, lines.join("\n"), true));
      }
      break;
    }
    case "history": {
      const range = (args || "24h").toLowerCase();
      if (range !== "1h" && range !== "6h" && range !== "24h") {
        store.addCommand(entry(trimmed, `Unknown range: ${args}. Valid: 1h, 6h, 24h`, false));
        break;
      }
      store.setHistoryRange(range);
      const now = Date.now() / 1000;
      const spanSec = range === "1h" ? 3600 : range === "6h" ? 21600 : 86400;
      const visible = store.getState().history.filter(([ts]) => ts >= now - spanSec).length;
      store.addCommand(entry(trimmed, `Chart range: ${range} · ${visible} samples visible`, true));
      break;
    }
    case "mute": {
      const mins = parseInt(args) || 5;
      store.setMuteUntil(Date.now() + mins * 60000);
      store.addCommand(entry(trimmed, `Toasts muted for ${mins} minutes`, true));
      break;
    }
    case "export": {
      const s = store.getState();
      const rows = ["id,ts,sev,title,src,body,ack,ack_ts"];
      for (const a of s.alerts) {
        rows.push([a.id, a.ts ?? "", a.sev, `"${(a.title || "").replace(/"/g, '""')}"`,
          a.src, `"${(a.body || "").replace(/"/g, '""')}"`, a.ack, a.ack_ts ?? ""].join(","));
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `voidmain-alerts-${Date.now()}.csv`; a.click();
      URL.revokeObjectURL(url);
      store.addCommand(entry(trimmed, `Exported ${s.alerts.length} alerts`, true));
      break;
    }
    case "device": {
      const q = (args || "").toLowerCase();
      if (!q) {
        store.addCommand(entry(trimmed, "Usage: /device <ip|mac>", false));
        break;
      }
      const devices = store.getState().devices;
      const macs = Object.keys(devices);
      if (!macs.length) {
        store.addCommand(entry(trimmed, "No devices observed yet", false));
        break;
      }
      const match = macs.find((m) =>
        m.toLowerCase() === q ||
        (devices[m]?.ip ?? "").toLowerCase() === q
      );
      if (!match) {
        store.addCommand(entry(trimmed, `No device matches ${args} — try /devices or click a node`, false));
      } else {
        store.setSelectedDevice(match);
        const dev = devices[match];
        store.addCommand(entry(trimmed, `Opened device card: ${dev?.vendor || match}`, true));
      }
      break;
    }
    default:
      store.addCommand(entry(trimmed, `Not implemented: /${name}`, false));
  }
}

export function autocomplete(input: string): CommandDef[] {
  if (!input.startsWith("/")) return [];
  const q = input.slice(1).toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(q));
}

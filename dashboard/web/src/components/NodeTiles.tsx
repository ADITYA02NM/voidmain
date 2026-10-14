import { rc } from "../dev/rc";
import { memo } from "react";
import { useStore } from "../store/store";
import { useNow } from "../hooks/useNow";
import { uptime } from "../lib/format";

const DEF = [
  { id: "pi4", nm: "Pi4", pil: "Governance", ip: "192.168.100.1", svc: ["mosquitto", "risk", "dashboard", "heal"] },
  { id: "pi3a", nm: "Pi3a", pil: "Detection", ip: "192.168.100.2", svc: ["suricata", "lan", "agg"] },
  { id: "pi3b", nm: "Pi3b", pil: "Alert", ip: "192.168.100.3", svc: ["alert", "report"] },
  { id: "esp32", nm: "ESP32", pil: "Indicator+Tripwire", ip: "USB / GPIO", svc: ["C3 OLED/LED", "WROOM reed"] },
];

const STATE: Record<string, string> = { up: "up", warn: "stale", down: "down", "": "no data" };

function NodeTilesImpl({ compact }: { compact?: boolean }) {
  rc("NodeTiles");
  const nodes = useStore((s) => s.nodes);
  const now = useNow(2000);
  const st = (id: string) => {
    const n = nodes[id]; if (!n) return "";
    const age = (now - n.lastSeen) / 1000;
    return age > 30 ? "down" : age > 15 ? "warn" : "up";
  };

  if (compact) {
    return (
      <div className="tiles-compact">
        {DEF.map((n) => (
          <div className={"tile-mini " + st(n.id)} key={n.id}>
            <span className={"sd " + st(n.id)} aria-hidden="true" />
            <span className="nm">{n.nm}</span>
            <span className="pil">{n.pil}</span>
            <span className="tm-state">{STATE[st(n.id)]}</span>
            {nodes[n.id]?.up != null && <span className="num up">{uptime(nodes[n.id]!.up)}</span>}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="tiles">
      {DEF.map((n) => (
        <div className="tile" key={n.id}>
          <div className="row"><span className="nm">{n.nm}</span><span className={"sd " + st(n.id)} /></div>
          <div className="pil">{n.pil}</div>
          <div className="meta">{n.ip} · uptime {nodes[n.id] ? uptime(nodes[n.id]!.up) : "—"}</div>
          <div className="svcs">{n.svc.map((s) => <span className="svc" key={s}>{s}</span>)}</div>
        </div>
      ))}
    </div>
  );
}

export const NodeTiles = memo(NodeTilesImpl);

import { memo, useEffect, useRef } from "react";
import { store, useStore } from "../store/store";
import { ago } from "../lib/format";
import { useNow, useReducedMotion } from "../hooks/useNow";
import type { NodeHealth } from "../store/store";

// Schematic of architecture.md §3.6: switch + Pi4/Pi3a/Pi3b + ESP32-C3/WROOM.
interface Dev { id: string; node?: string; x: number; y: number; w: number; h: number; label: string; sub: string; }
const DEVS: Dev[] = [
  { id: "switch", x: 250, y: 16, w: 100, h: 34, label: "5-PORT SWITCH", sub: "" },
  { id: "pi4", node: "pi4", x: 250, y: 150, w: 100, h: 48, label: "Pi4 · GOV", sub: "192.168.100.1" },
  { id: "pi3a", node: "pi3a", x: 46, y: 112, w: 118, h: 46, label: "Pi3a · DET", sub: "192.168.100.2" },
  { id: "pi3b", node: "pi3b", x: 436, y: 112, w: 118, h: 46, label: "Pi3b · ALR", sub: "192.168.100.3" },
  { id: "c3", node: "esp32", x: 250, y: 254, w: 100, h: 44, label: "ESP32-C3", sub: "OLED · LED" },
  { id: "wroom", x: 46, y: 252, w: 118, h: 40, label: "ESP32-WROOM", sub: "tripwire · GPIO" },
];
// Cat6: each Pi -> switch.
const CABLES: Array<{ node: string; d: string }> = [
  { node: "pi4", d: "M300,150 L300,50" },
  { node: "pi3a", d: "M164,120 C220,120 250,70 250,50" },
  { node: "pi3b", d: "M436,120 C380,120 350,70 350,50" },
];

const EMPTY: Record<string, NodeHealth> = {};

function status(h: NodeHealth | undefined, now: number): "up" | "warn" | "down" | "" {
  if (!h) return "";
  const age = (now - h.lastSeen) / 1000;
  return age > 30 ? "down" : age > 15 ? "warn" : "up";
}

function HardwareTwinImpl({ idle }: { idle?: boolean }) {
  const liveNodes = useStore((s) => s.nodes);
  const nodes = idle ? EMPTY : liveNodes;
  const tripSeq = useStore((s) => s.layers.tripSeq);
  const focus = useStore((s) => s.focusNode);
  const now = useNow(2000);
  const reduce = useReducedMotion();
  const lidRefs = useRef<Record<string, SVGGElement | null>>({});
  const pulseRefs = useRef<Record<string, SVGCircleElement | null>>({});
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({});
  const lastEvent = useRef(0);

  // Tripwire lid pop (money moment).
  useEffect(() => {
    if (idle || !tripSeq) return;
    ["pi3a", "pi3b"].forEach((id) => {
      const g = lidRefs.current[id];
      if (!g) return;
      g.classList.add("open");
      window.setTimeout(() => g.classList.remove("open"), 1300);
    });
  }, [tripSeq, idle]);

  // Packet pulses: pooled circles animated along cable paths on each event.
  useEffect(() => {
    if (reduce || idle) return;
    const unsub = store.subscribe(() => {
      const ec = store.getState().eventCount;
      if (ec === lastEvent.current) return;
      lastEvent.current = ec;
      for (const c of CABLES) {
        const path = pathRefs.current[c.node];
        const dot = pulseRefs.current[c.node];
        if (!path || !dot) continue;
        const len = path.getTotalLength();
        const t0 = performance.now();
        const run = (t: number) => {
          const k = Math.min(1, (t - t0) / 650);
          const p = path.getPointAtLength(len * (1 - k)); // node -> switch -> to Pi4 end
          dot.setAttribute("cx", String(p.x));
          dot.setAttribute("cy", String(p.y));
          dot.style.opacity = k < 1 ? "1" : "0";
          if (k < 1) requestAnimationFrame(run);
        };
        requestAnimationFrame(run);
      }
    });
    return unsub;
  }, [reduce, idle]);

  return (
    <svg className={"twin" + (focus ? " has-focus" : "") + (idle ? " idle" : "")} viewBox="0 0 600 310" role="img" aria-label="Hardware twin">
      {CABLES.map((c) => {
        const st = status(nodes[c.node], now);
        return <path key={c.node} ref={(el) => (pathRefs.current[c.node] = el)}
          className={"cable" + (st === "down" ? " dead" : "")} d={c.d} />;
      })}
      {CABLES.map((c) => (
        <circle key={"p" + c.node} ref={(el) => (pulseRefs.current[c.node] = el)}
          className="pulse-dot" r="3" fill="var(--accent)" style={{ opacity: 0 }} />
      ))}
      {/* WROOM jumpers to Pi3 lids (data path = GPIO only) */}
      <path className="cable dead" d="M120,252 C120,200 105,175 110,158" />
      <path className="cable dead" d="M150,252 C300,220 470,200 495,158" />

      {DEVS.map((d) => {
        const st = d.node ? status(nodes[d.node], now) : "";
        return (
          <g key={d.id} className={`dev${focus && focus === d.id ? " focused" : ""}`}>
            <rect className="dev-body" x={d.x} y={d.y} width={d.w} height={d.h} rx="3" />
            {(d.id === "pi3a" || d.id === "pi3b") && (
              <g ref={(el) => (lidRefs.current[d.id] = el)} className="lid">
                <rect className="lid-rect" x={d.x} y={d.y - 11} width={d.w} height={11} rx="2" />
              </g>
            )}
            <circle className={"status " + st} cx={d.x + d.w - 10} cy={d.y + 10} />
            <text className="dev-label" x={d.x + 8} y={d.y + d.h - 14}>{d.label}</text>
            {d.sub && <text className="dev-label" x={d.x + 8} y={d.y + d.h - 4}>{d.sub}</text>}
            {d.node && status(nodes[d.node], now) === "down" && (
              <text className="dev-label alarm" x={d.x + 8} y={d.y - 8}>
                NO HEARTBEAT · {ago(Math.floor((nodes[d.node]?.lastSeen ?? now) / 1000), now)}
              </text>
            )}
          </g>
        );
      })}
      {/* C3 OLED window */}
      <rect x={306} y={262} width={36} height={20} rx="1" fill="var(--oled-bg)" stroke="var(--border-2)" />
    </svg>
  );
}

export const HardwareTwin = memo(HardwareTwinImpl);

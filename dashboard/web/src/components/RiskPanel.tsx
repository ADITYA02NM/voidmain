import { rc } from "../dev/rc";
import { memo, useEffect, useRef } from "react";
import { store, useStore } from "../store/store";
import { POSTURE } from "../lib/bands";
import { ago } from "../lib/format";
import { useNow, useReducedMotion } from "../hooks/useNow";

const R = 70, C = 2 * Math.PI * R, CX = 90, CY = 90;

function tickPos(frac: number, r1: number, r2: number) {
  const a = -Math.PI / 2 + frac * 2 * Math.PI;
  return { x1: CX + r1 * Math.cos(a), y1: CY + r1 * Math.sin(a), x2: CX + r2 * Math.cos(a), y2: CY + r2 * Math.sin(a) };
}

function RiskPanelImpl() {
  rc("RiskPanel");
  const band = useStore((s) => s.band);
  const conn = useStore((s) => s.conn);
  const scoreTs = useStore((s) => s.scoreTs);
  const now = useNow(1000);
  const reduce = useReducedMotion();
  const stale = conn !== "live";
  const numRef = useRef<HTMLSpanElement>(null);
  const valRef = useRef<SVGCircleElement>(null);
  const prev = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    const paint = (v: number) => {
      if (numRef.current) numRef.current.textContent = String(Math.round(v));
      if (valRef.current) valRef.current.style.strokeDashoffset = String(C * (1 - v / 100));
    };
    const unsub = store.subscribe(() => {
      const target = store.getState().score;
      if (target === prev.current) return;
      const from = prev.current;
      prev.current = target;
      if (reduce) { paint(target); return; }
      const t0 = performance.now();
      const dur = 300;
      cancelAnimationFrame(raf.current);
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / dur);
        paint(from + (target - from) * (k * (2 - k))); // ease-out
        if (k < 1) raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    });
    paint(store.getState().score);
    prev.current = store.getState().score;
    return () => { unsub(); cancelAnimationFrame(raf.current); };
  }, [reduce]);

  return (
    <div className="risk">
      <svg className="ring" viewBox="0 0 180 180" role="img" aria-label="Risk gauge">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--border-2)" strokeWidth="2" />
        <circle ref={valRef} cx={CX} cy={CY} r={R} fill="none" stroke="var(--accent)" strokeWidth="6"
          strokeLinecap="butt" strokeDasharray={C} strokeDashoffset={C}
          transform={`rotate(-90 ${CX} ${CY})`}
          style={{ transition: reduce ? "none" : "stroke var(--dur)" }} />
        {[30, 60, 85].map((v) => {
          const p = tickPos(v / 100, R - 5, R + 5);
          const l = tickPos(v / 100, R + 13, R + 13);
          return (
            <g key={v}>
              <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke="var(--muted)" strokeWidth="1.5" />
              <text className="ring-lbl" x={l.x1} y={l.y1} textAnchor="middle" dominantBaseline="middle">{v}</text>
            </g>
          );
        })}
      </svg>
      <div className="read">
        <div>
          <span className={"numeral" + (stale ? " stale" : "")} ref={numRef}>0</span>
          <span className="of"> /100</span>
        </div>
        <div className="band">{band}</div>
        {stale
          ? <div className="posture">last known · {ago(scoreTs, now)} ago</div>
          : <div className="posture">{POSTURE[band]}</div>}
        <div className="note">notify only — response is Phase 2</div>
      </div>
    </div>
  );
}

export const RiskPanel = memo(RiskPanelImpl);

import { memo, useEffect, useRef } from "react";
import { store } from "../store/store";
import { bandForScore } from "../lib/bands";
import { cssVar } from "../lib/cssVars";

export type HistoryRange = "1h" | "6h" | "24h";

/** Pure range filter over [tsSec, value] points. Exported for tests. */
export function filterHistory(
  points: Array<[number, number]>,
  range: HistoryRange,
  nowMs: number,
): Array<[number, number]> {
  const spanSec = range === "1h" ? 3600 : range === "6h" ? 21600 : 86400;
  const cutoff = nowMs / 1000 - spanSec;
  return points.filter(([ts]) => ts >= cutoff);
}

function HistoryImpl({ compact }: { compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const draw = () => {
      const c = canvasRef.current; if (!c) return;
      const s = store.getState();
      const hist = filterHistory(s.history, s.historyRange, Date.now());
      const dpr = window.devicePixelRatio || 1;
      const h0 = parseFloat(cssVar(compact ? "--spark-h-compact" : "--spark-h"));
      const w = (c.width = Math.floor(c.clientWidth * dpr));
      const h = (c.height = Math.floor(h0 * dpr));
      const ctx = c.getContext("2d"); if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = cssVar("--border"); ctx.lineWidth = dpr; ctx.setLineDash([4 * dpr, 4 * dpr]);
      const fs = parseFloat(cssVar("--fs-xs")) * dpr;
      ctx.font = `${fs}px ${cssVar("--mono")}`; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      [30, 60, 85].forEach((g) => {
        const y = h - (g / 100) * h;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w - fs * 2.2, y); ctx.stroke();
        ctx.fillStyle = cssVar("--muted-2"); ctx.fillText(String(g), w - 2 * dpr, y + fs / 2);
      });
      ctx.setLineDash([]);
      if (!hist.length) { if (noteRef.current) noteRef.current.textContent = "history empty — skeleton"; return; }
      if (noteRef.current) noteRef.current.textContent = `${hist.length} samples · ${hist[hist.length - 1]![1]} now`;
      const t0 = hist[0]![0], t1 = hist[hist.length - 1]![0] || t0 + 1, span = Math.max(1, t1 - t0);
      for (let i = 1; i < hist.length; i++) {
        const x0 = ((hist[i - 1]![0] - t0) / span) * w, x1 = ((hist[i]![0] - t0) / span) * w;
        const y0 = h - (hist[i - 1]![1] / 100) * h, y1 = h - (hist[i]![1] / 100) * h;
        ctx.strokeStyle = cssVar("--" + bandForScore(hist[i]![1]).toLowerCase()); ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    };
    let pending = false;
    const req = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; draw(); }); } };
    const unsub = store.subscribe(req);
    draw();
    window.addEventListener("resize", draw);
    return () => { unsub(); window.removeEventListener("resize", draw); };
  }, [compact]);

  return (
    <div className={compact ? "hist-compact" : ""}>
      <canvas className={`spark${compact ? " spark-compact" : ""}`} ref={canvasRef} />
      {!compact && <div className="histnote" ref={noteRef}>awaiting history…</div>}
      {compact && <div className="histnote" ref={noteRef} />}
    </div>
  );
}

export const History = memo(HistoryImpl);

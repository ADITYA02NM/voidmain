import { memo, useEffect, useRef } from "react";
import { store, useStore } from "../store/store";
import { LED_PATTERN } from "../lib/bands";
import { cssVar } from "../lib/cssVars";
import { useReducedMotion } from "../hooks/useNow";
import type { Band } from "../contracts/ws";

const NLED = 8;

// Mirrors the ESP32-C3 SSD1306 OLED (128x64) + WS2812B x8 strip.
function IndicatorTwinImpl() {
  const band = useStore((s) => s.band);
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ledRefs = useRef<Array<HTMLSpanElement | null>>([]);

  // OLED: redraw on any relevant store change (throttled by rAF).
  useEffect(() => {
    let pending = false;
    const draw = () => {
      pending = false;
      const c = canvasRef.current; if (!c) return;
      const ctx = c.getContext("2d"); if (!ctx) return;
      const s = store.getState();
      const oledBg = cssVar("--oled-bg");
      const oledFg = cssVar("--oled-fg");
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = oledBg; ctx.fillRect(0, 0, 128, 64);
      ctx.fillStyle = oledFg;
      ctx.font = "8px ui-monospace, monospace"; ctx.textBaseline = "top";
      ctx.fillText("VoidMain", 3, 3);
      ctx.fillText(s.band, 128 - s.band.length * 6 - 3, 3);
      ctx.font = "bold 30px ui-monospace, monospace";
      ctx.fillText(String(Math.round(s.score)), 6, 20);
      ctx.font = "7px ui-monospace, monospace";
      ctx.fillText("/100", 70, 40);
      // node dots (pi4/pi3a/pi3b/esp)
      const ids = ["pi4", "pi3a", "pi3b", "esp32"];
      ids.forEach((id, i) => {
        const on = !!s.nodes[id];
        ctx.strokeStyle = oledFg;
        ctx.strokeRect(4 + i * 12, 54, 7, 7);
        if (on) ctx.fillRect(5 + i * 12, 55, 5, 5);
      });
    };
    const req = () => { if (!pending) { pending = true; requestAnimationFrame(draw); } };
    const unsub = store.subscribe(req);
    draw();
    return unsub;
  }, []);

  // LED strip pattern per band.
  useEffect(() => {
    const cells = ledRefs.current.filter(Boolean) as HTMLSpanElement[];
    const all = cells.map((_, i) => i);
    const setOn = (arr: number[]) => cells.forEach((c, i) => c.classList.toggle("on", arr.includes(i)));
    const pattern = LED_PATTERN[band as Band];
    if (reduce || pattern === "solid") { setOn(all); return; }
    let f = 0; let raf = 0; let t0 = performance.now();
    const tick = (t: number) => {
      if (t - t0 >= 130) {
        t0 = t; f++;
        if (pattern === "chase") setOn([f % NLED, (f + 1) % NLED]);
        else if (pattern === "strobe") setOn(f % 2 ? all : []);
        else if (pattern === "pulse") {
          const seq = [[], [0, 7], [0, 1, 6, 7], all, [0, 1, 6, 7], [0, 7]][f % 6] as number[];
          setOn(seq);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [band, reduce]);

  return (
    <div className="indicator">
      <canvas className="oled" ref={canvasRef} width={128} height={64} style={{ width: 200, height: 100 }} />
      <div className="leds" aria-hidden="true">
        {Array.from({ length: NLED }, (_, i) => (
          <span key={i} className="led-dot" ref={(el) => (ledRefs.current[i] = el)} />
        ))}
      </div>
    </div>
  );
}

export const IndicatorTwin = memo(IndicatorTwinImpl);

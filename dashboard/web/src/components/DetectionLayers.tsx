import { rc } from "../dev/rc";
import { memo, useEffect, useRef } from "react";
import { useStore } from "../store/store";
import { ago } from "../lib/format";
import { useNow, useReducedMotion } from "../hooks/useNow";

function DetectionLayersImpl() {
  rc("DetectionLayers");
  const layers = useStore((s) => s.layers);
  const now = useNow(1000);
  const reduce = useReducedMotion();
  const tripRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (layers.tripSeq === seq.current) return;
    seq.current = layers.tripSeq;
    if (!tripRef.current || !layers.tripSeq || reduce) return;
    const el = tripRef.current;
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  }, [layers.tripSeq, reduce]);

  const rows = [
    { k: "ids", name: "IDS", lit: layers.idsCount > 0, val: `${layers.idsCount} alerts · last ${ago(layers.idsLast, now)}` },
    { k: "lan", name: "LAN Watch", lit: layers.lanToday > 0, val: `${layers.lanToday} unknown today` },
    { k: "wifi", name: "WiFi", lit: layers.wifiLast > 0, val: `${layers.wifiRogue ? "rogue flag" : "clear"} · last ${ago(layers.wifiLast, now)}` },
    { k: "trip", name: "Tripwire", lit: layers.tripLast > 0, val: `armed · last ${ago(layers.tripLast, now)}` },
  ];

  return (
    <div className="layers">
      {rows.map((r) => (
        <div key={r.k} className={"layer" + (r.lit ? " lit" : "")} ref={r.k === "trip" ? tripRef : undefined}>
          <span className="cube" />
          <span className="lname">{r.name}</span>
          <span className="lval">{r.val}</span>
        </div>
      ))}
    </div>
  );
}

export const DetectionLayers = memo(DetectionLayersImpl);

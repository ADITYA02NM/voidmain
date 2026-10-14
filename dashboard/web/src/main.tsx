import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts.css";
import "./styles/global.css";
import App from "./App";
import { transport } from "./transport/transport";
import { store } from "./store/store";
import type { Band } from "./contracts/ws";

const q = new URLSearchParams(location.search);
if (q.get("perf")) {
  const g = window as unknown as { __ultronPerf: { handler: number[] }; __ultronRC: Record<string, number> };
  g.__ultronPerf = { handler: [] };
  g.__ultronRC = {};
}

const seedParam = q.get("seed");

const w = window as unknown as { __ultron?: unknown };
if (import.meta.env.DEV && (q.get("perf") || seedParam)) {
  w.__ultron = { store };
} else if (q.get("perf")) {
  // Production ?perf: read-only metrics snapshot, no store handle.
  w.__ultron = Object.freeze({
    metrics: () => {
      const s = store.getState();
      return Object.freeze({
        latencyLast: s.latencyLast, latencyP95: s.latencyP95,
        eventCount: s.eventCount, conn: s.conn,
      });
    },
  });
}

if (import.meta.env.DEV && seedParam) {
  void import("./dev/seed").then(({ seedForDesign }) =>
    seedForDesign((seedParam.toUpperCase() as Band)));
} else {
  // Start transport only when auth reaches "ready"
  const unsub = store.subscribe(() => {
    if (store.getState().authPhase === "ready") {
      unsub();
      transport.start();
    }
  });
  // Also start immediately if already ready (e.g., cookie still valid)
  if (store.getState().authPhase === "ready") {
    unsub();
    transport.start();
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

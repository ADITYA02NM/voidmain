import { describe, it, expect } from "vitest";
import { bandForScore, isWorse, bandRank } from "../src/lib/bands";
import { LatencyWindow, ClockSync } from "../src/lib/latency";
import { isEnvelope, isPong } from "../src/contracts/ws";
import { Store } from "../src/store/store";
import { filterHistory } from "../src/components/History";
import type { Envelope } from "../src/contracts/ws";

const env = (t: string, d: unknown, ts = Date.now() / 1000): Envelope =>
  ({ t, ts, d } as unknown as Envelope);

describe("bands", () => {
  it("maps score to band at the exact edges", () => {
    expect(bandForScore(0)).toBe("GREEN");
    expect(bandForScore(29)).toBe("GREEN");
    expect(bandForScore(30)).toBe("YELLOW");
    expect(bandForScore(59)).toBe("YELLOW");
    expect(bandForScore(60)).toBe("RED");
    expect(bandForScore(84)).toBe("RED");
    expect(bandForScore(85)).toBe("PURPLE");
    expect(bandForScore(100)).toBe("PURPLE");
  });
  it("orders severity and detects worsening", () => {
    expect(bandRank("GREEN")).toBeLessThan(bandRank("PURPLE"));
    expect(isWorse("RED", "GREEN")).toBe(true);
    expect(isWorse("GREEN", "RED")).toBe(false);
  });
});

describe("latency math", () => {
  it("computes percentiles", () => {
    const w = new LatencyWindow(100);
    for (let i = 1; i <= 100; i++) w.add(i);
    expect(w.p50()).toBeGreaterThanOrEqual(50);
    expect(w.p95()).toBeGreaterThanOrEqual(95);
    expect(w.count()).toBe(100);
  });
  it("estimates a stable clock offset", () => {
    const c = new ClockSync();
    // server is 1000ms ahead; rtt 20ms => offset ~1000
    for (let i = 0; i < 5; i++) c.addPong(1000, 2010, 1020);
    expect(c.ready()).toBe(true);
    expect(Math.abs(c.offsetMs() - 1000)).toBeLessThan(5);
  });
});

describe("contract guards", () => {
  it("accepts valid envelopes and pongs", () => {
    expect(isEnvelope({ t: "score", ts: 1, d: { v: 5 } })).toBe(true);
    expect(isEnvelope({ t: "nope", ts: 1, d: {} })).toBe(false);
    expect(isPong({ ctl: "pong", c: 1, s: 2 })).toBe(true);
    expect(isPong({ t: "score" })).toBe(false);
  });
});

describe("store.applyBatch", () => {
  it("updates score + appends history", () => {
    const s = new Store();
    s.applyBatch([env("score", { v: 42 })]);
    expect(s.getState().score).toBe(42);
    expect(s.getState().history.length).toBe(1);
  });
  it("bumps on worsening band only", () => {
    const s = new Store();
    s.applyBatch([env("band", { b: "GREEN" })]);
    const b0 = s.getState().bandBump;
    s.applyBatch([env("band", { b: "RED" })]);   // worse -> bump
    s.applyBatch([env("band", { b: "GREEN" })]); // better -> no bump
    expect(s.getState().bandBump).toBe(b0 + 1);
    expect(s.getState().band).toBe("GREEN");
  });
  it("dedupes alert ids and counts open vs acked", () => {
    const s = new Store();
    s.applyBatch([env("alert", { id: "x", sev: "red", title: "t", src: "s", body: "b", ack: false })]);
    s.applyBatch([env("alert", { id: "x", sev: "red", title: "t", src: "s", body: "b", ack: false })]); // dup
    s.applyBatch([env("alert", { id: "y", sev: "red", title: "t", src: "s", body: "b", ack: true })]);
    const st = s.getState();
    expect(st.alerts.length).toBe(2);
    expect(st.openCount).toBe(1);
    expect(st.ackDone).toBe(1);
  });
  it("ackLocal decrements open and marks acked", () => {
    const s = new Store();
    s.applyBatch([env("alert", { id: "x", sev: "red", title: "t", src: "s", body: "b", ack: false })]);
    expect(s.getState().openCount).toBe(1);
    s.ackLocal("x");
    expect(s.getState().openCount).toBe(0);
    expect(s.getState().alerts[0]!.ack).toBe(true);
  });
  // CP5 contract: suricata/wifi arrive as t:"event", never t:"alert".
  it("routes suricata/wifi events into detection layers", () => {
    const s = new Store();
    s.applyBatch([env("event", { topic: "voidmain/suricata/eth0", node: "pi3a", kind: "suricata", sev: "red", summary: "ET x" })]);
    s.applyBatch([env("event", { topic: "voidmain/wifi/rogue", node: "pi3a", kind: "wifi", sev: "yellow", summary: "rogue AP" })]);
    expect(s.getState().layers.idsCount).toBe(1);
    expect(s.getState().layers.wifiRogue).toBe(true);
  });
});

describe("filterHistory", () => {
  const nowMs = 1_000_000_000_000; // fixed epoch ms
  it("drops points older than the range span", () => {
    const points: Array<[number, number]> = [
      [nowMs / 1000 - 7200, 10], // 2h ago -> outside 1h
      [nowMs / 1000 - 1800, 20], // 30m ago -> inside 1h
      [nowMs / 1000, 30],        // now -> inside 1h
    ];
    const out = filterHistory(points, "1h", nowMs);
    expect(out.length).toBe(2);
    expect(out.every(([, v]) => v !== 10)).toBe(true);
  });
  it("handles an empty series", () => {
    expect(filterHistory([], "24h", nowMs)).toEqual([]);
  });
  it("24h keeps a full day of recent points", () => {
    const points: Array<[number, number]> = [
      [nowMs / 1000 - 86000, 1], // just under 24h ago
      [nowMs / 1000 - 100000, 2], // >24h ago -> dropped
      [nowMs / 1000 - 60, 3],
    ];
    const out = filterHistory(points, "24h", nowMs);
    expect(out.length).toBe(2);
    expect(out.map(([, v]) => v).sort()).toEqual([1, 3]);
  });
});

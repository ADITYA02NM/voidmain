import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { simulation } from "../src/lib/simulation";
import { store } from "../src/store/store";
import { transport } from "../src/transport/transport";

// The ▶ SIM TOUR button (Header -> simulation.toggle()) must relay
// {sim:"start"|"stop"} to the server when the WS is open, so the tour runs on
// the MQTT bus and the dashboard + ESP32 OLED change together. The local beat
// script is the offline fallback only — in this node test env it would throw
// (no window) and it would seed node health synchronously if it ever ran here.
const rec = transport as unknown as Record<string, unknown>;

describe("SIM TOUR bus relay", () => {
  const sendSim = vi.fn();

  beforeEach(() => {
    sendSim.mockReset();
    rec["sendSim"] = sendSim;
    // `live` is a getter-only accessor on Transport's prototype, so an own data
    // property has to be defined rather than assigned.
    Object.defineProperty(transport, "live", { value: true, configurable: true });
  });

  afterEach(() => {
    if (simulation.isRunning()) simulation.stop();
    delete rec["sendSim"]; // prototype method again
    delete rec["live"]; // prototype getter again
  });

  it("toggle() relays start then stop and tracks the button state", () => {
    simulation.toggle(); // ▶ SIM TOUR
    expect(sendSim).toHaveBeenCalledWith("start");
    expect(sendSim).not.toHaveBeenCalledWith("stop");
    expect(store.getState().simRunning).toBe(true);

    simulation.toggle(); // ■ STOP
    expect(sendSim).toHaveBeenCalledWith("stop");
    expect(store.getState().simRunning).toBe(false);
  });

  it("does not run the local beat script while bus-backed", () => {
    const nodesBefore = Object.keys(store.getState().nodes).length;
    simulation.start();
    // a local start() would call healthPump() immediately and seed 4 nodes
    expect(Object.keys(store.getState().nodes).length).toBe(nodesBefore);
    expect(sendSim).toHaveBeenCalledTimes(1);
    simulation.stop();
    expect(sendSim).toHaveBeenCalledTimes(2);
  });
});

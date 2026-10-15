import { memo } from "react";
import { useStore, store } from "../store/store";
import type { IoTDevice } from "../store/store";

const ICONS: Record<string, string> = {
  lock: "🔒", light: "💡", thermostat: "🌡️", garage: "🚪",
  plug: "🔌", motion: "📡", smoke: "🔥", leak: "💧",
  camera: "🎥", purifier: "🌿", curtain: "🪟",
};

function DeviceCard({ d }: { d: IoTDevice }) {
  const toggle = () => {
    if (d.kind === "lock" || d.kind === "garage") {
      store.applyBatch([{
        t: "device", ts: Date.now() / 1000,
        d: { ...d, locked: !d.locked, state: d.locked ? "Unlocked" : "Locked", sev: "green", automation: undefined },
      } as never]);
    } else if (["light", "plug", "purifier", "curtain"].includes(d.kind)) {
      store.applyBatch([{
        t: "device", ts: Date.now() / 1000,
        d: { ...d, on: !d.on, state: d.on ? "Off" : "On", sev: "green", automation: undefined },
      } as never]);
    }
  };

  const canToggle = ["lock", "garage", "light", "plug", "purifier", "curtain"].includes(d.kind);

  return (
    <div className={`iot-card iot-card--${d.sev}`}>
      <div className="iot-card-hd">
        <span className="iot-icon">{ICONS[d.kind] ?? "📡"}</span>
        <span className="iot-name">{d.name}</span>
        <span className={`iot-dot iot-dot--${d.sev}`} />
      </div>
      <div className="iot-room">{d.room}</div>
      <div className="iot-state">{d.state}</div>
      {d.automation && <div className="iot-auto">{d.automation}</div>}
      {canToggle && (
        <button className="iot-toggle" onClick={toggle}>
          {d.kind === "lock" || d.kind === "garage"
            ? (d.locked ? "Unlock" : "Lock")
            : (d.on ? "Turn off" : "Turn on")}
        </button>
      )}
    </div>
  );
}

function DevicesPanelImpl() {
  const show = useStore((s) => s.showDevices);
  const iot = useStore((s) => s.iot);

  if (!show) return null;

  const list = Object.values(iot).sort((a, b) => a.name.localeCompare(b.name));
  const counts = {
    green: list.filter((d) => d.sev === "green").length,
    yellow: list.filter((d) => d.sev === "yellow").length,
    red: list.filter((d) => d.sev === "red").length,
    purple: list.filter((d) => d.sev === "purple").length,
  };

  return (
    <div className="devices-overlay" onClick={() => store.setShowDevices(false)}>
      <div className="devices-panel iot-panel" onClick={(e) => e.stopPropagation()}>
        <div className="devices-hd">
          <span className="label">IoT DEVICES</span>
          <div className="iot-legend">
            <span className="iot-legend-item"><span className="iot-dot iot-dot--green" /> {counts.green}</span>
            <span className="iot-legend-item"><span className="iot-dot iot-dot--yellow" /> {counts.yellow}</span>
            <span className="iot-legend-item"><span className="iot-dot iot-dot--red" /> {counts.red}</span>
            <span className="iot-legend-item"><span className="iot-dot iot-dot--purple" /> {counts.purple}</span>
          </div>
          <button className="devices-close" onClick={() => store.setShowDevices(false)} aria-label="Close">&times;</button>
        </div>
        <div className="devices-list iot-grid">
          {list.map((d) => <DeviceCard key={d.id} d={d} />)}
          {list.length === 0 && (
            <div className="devices-empty">No IoT devices yet — run SIM TOUR to see them</div>
          )}
        </div>
      </div>
    </div>
  );
}

export const DevicesPanel = memo(DevicesPanelImpl);

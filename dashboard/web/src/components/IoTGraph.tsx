import { memo, useCallback, useMemo, useState } from "react";
import { store, useStore } from "../store/store";
import type { IoTDevice, UEvent } from "../store/store";
import { useReducedMotion } from "../hooks/useNow";

const KIND_ICON: Record<string, string> = {
  lock: "🔒", light: "💡", thermostat: "🌡", garage: "🚪", plug: "🔌",
  motion: "🚶", smoke: "🚨", leak: "💧", camera: "📷", purifier: "💨", curtain: "🪟",
};
const SEV_COLOR: Record<string, string> = {
  green: "var(--green)", yellow: "var(--yellow)", red: "var(--red)", purple: "var(--purple)",
};
const SEV_LABEL: Record<string, string> = {
  green: "Normal", yellow: "Detected", red: "Alert", purple: "Action",
};

function matches(dev: IoTDevice, ev: UEvent): boolean {
  if (ev.node && ev.node === dev.id) return true;
  const s = (ev.summary || "").toLowerCase();
  return s.includes(dev.name.toLowerCase()) || s.includes(dev.id.toLowerCase());
}

function IoTGraphImpl() {
  const iotMap = useStore((s) => s.iot);
  const events = useStore((s) => s.events);
  const selectedId = useStore((s) => s.selectedDevice);
  const reduce = useReducedMotion();
  const [filter, setFilter] = useState<"all" | "alert" | "sensor" | "actuator">("all");

  const devices = useMemo(() => Object.values(iotMap).sort((a, b) => a.name.localeCompare(b.name)), [iotMap]);

  const recent = useMemo(() => events.slice(0, 50), [events]);
  const litIds = useMemo(() => {
    const set = new Set<string>();
    for (const ev of recent) {
      for (const d of devices) {
        if (matches(d, ev)) set.add(d.id);
      }
    }
    return set;
  }, [recent, devices]);

  const SENSOR_KINDS = new Set(["motion", "smoke", "leak", "camera"]);
  const filtered = useMemo(() => {
    if (filter === "alert") return devices.filter((d) => d.sev !== "green");
    if (filter === "sensor") return devices.filter((d) => SENSOR_KINDS.has(d.kind));
    if (filter === "actuator") return devices.filter((d) => !SENSOR_KINDS.has(d.kind));
    return devices;
  }, [devices, filter]);

  const selectedDev = selectedId ? iotMap[selectedId] : null;
  const selectedEvents = useMemo(() => {
    if (!selectedDev) return [];
    return recent.filter((ev) => matches(selectedDev, ev)).slice(0, 8);
  }, [selectedDev, recent]);

  const onClick = useCallback((id: string) => {
    store.setSelectedDevice(store.getState().selectedDevice === id ? null : id);
  }, []);

  const counts = useMemo(() => ({
    all: devices.length,
    alert: devices.filter((d) => d.sev !== "green").length,
    sensor: devices.filter((d) => SENSOR_KINDS.has(d.kind)).length,
    actuator: devices.filter((d) => !SENSOR_KINDS.has(d.kind)).length,
  }), [devices]);

  if (!devices.length) {
    return <div className="iot-empty empty">No IoT devices yet — start SIM TOUR to seed the home</div>;
  }

  return (
    <div className="iot-wrap">
      {/* filter tabs */}
      <div className="iot-tabs" role="tablist" aria-label="Device filters">
        {(["all", "alert", "sensor", "actuator"] as const).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            className={`iot-tab${filter === f ? " iot-tab--active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "alert" ? "Active" : f === "sensor" ? "Sensors" : "Actuators"}
            <span className="iot-tab-n">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* device grid */}
      <div className="iot-grid">
        {filtered.map((dev) => {
          const sevColor = SEV_COLOR[dev.sev] || "var(--border)";
          const lit = litIds.has(dev.id);
          const sel = selectedId === dev.id;
          const icon = KIND_ICON[dev.kind] || "📡";
          return (
            <button
              key={dev.id}
              className={`iot-tile${sel ? " iot-tile--sel" : ""}${lit && !reduce ? " iot-tile--lit" : ""}`}
              style={{ borderColor: sevColor }}
              onClick={() => onClick(dev.id)}
              aria-pressed={sel}
              aria-label={`${dev.name} in ${dev.room}, ${SEV_LABEL[dev.sev] || dev.sev}`}
            >
              <div className="iot-tile-top">
                <span className="iot-tile-icon">{icon}</span>
                <span className="iot-tile-dot" style={{ background: sevColor, boxShadow: `0 0 var(--node-glow-sm) ${sevColor}` }} />
              </div>
              <div className="iot-tile-name">{dev.name}</div>
              <div className="iot-tile-room">{dev.room}</div>
              <div className="iot-tile-sev" style={{ color: sevColor }}>{SEV_LABEL[dev.sev] || dev.sev}</div>
              {dev.automation && <div className="iot-tile-auto">⚡ {dev.automation}</div>}
            </button>
          );
        })}
      </div>

      {/* detail drawer */}
      {selectedDev && (
        <div className="iot-detail">
          <div className="iot-detail-hd">
            <span className="iot-detail-vendor">{KIND_ICON[selectedDev.kind] || "📡"} {selectedDev.name}</span>
            <button className="iot-detail-close" aria-label="Close device details" onClick={() => store.setSelectedDevice(null)}>×</button>
          </div>
          <div className="iot-detail-row"><span className="k">Kind</span><span>{selectedDev.kind}</span></div>
          <div className="iot-detail-row"><span className="k">Room</span><span>{selectedDev.room}</span></div>
          <div className="iot-detail-row"><span className="k">State</span><span style={{ color: SEV_COLOR[selectedDev.sev] }}>{selectedDev.state}</span></div>
          <div className="iot-detail-row"><span className="k">Severity</span><span style={{ color: SEV_COLOR[selectedDev.sev] }}>{SEV_LABEL[selectedDev.sev] || selectedDev.sev}</span></div>
          {selectedDev.automation && (
            <div className="iot-detail-row"><span className="k">Automation</span><span style={{ color: "var(--purple)" }}>{selectedDev.automation}</span></div>
          )}
          {selectedEvents.length > 0 && (
            <>
              <div className="label iot-detail-sub">Recent events</div>
              {selectedEvents.map((ev) => (
                <div key={ev.id} className={`iot-detail-ev sev-${ev.sev}`}>
                  <span>{ev.summary}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const IoTGraph = memo(IoTGraphImpl);

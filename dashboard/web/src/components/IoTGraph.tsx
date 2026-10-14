import { memo, useCallback, useMemo } from "react";
import { store, useStore } from "../store/store";
import type { LanDevice, UEvent } from "../store/store";
import { useNow, useReducedMotion } from "../hooks/useNow";
import { utcTime } from "../lib/format";

const CX = 300, CY = 180, RADIUS = 130;

function shortMac(mac: string): string {
  const parts = mac.split(":");
  return parts.length >= 4 ? `${parts[0]}:${parts[1]}:…:${parts[parts.length - 1]}` : mac;
}

function deviceAngle(index: number, total: number): number {
  if (total <= 0) return 0;
  return (index / total) * Math.PI * 2 - Math.PI / 2;
}

interface DevPos { x: number; y: number; dev: LanDevice; }

function layoutDevices(devices: LanDevice[]): DevPos[] {
  const sorted = [...devices].sort((a, b) => {
    if (a.known !== b.known) return a.known ? -1 : 1;
    return (a.vendor || "zzz").localeCompare(b.vendor || "zzz");
  });
  return sorted.map((dev, i) => {
    const angle = deviceAngle(i, sorted.length);
    return {
      x: CX + RADIUS * Math.cos(angle),
      y: CY + RADIUS * Math.sin(angle),
      dev,
    };
  });
}

function isRecentJoin(dev: LanDevice, nowSec: number): boolean {
  return !!dev.lastSeen && (nowSec - dev.lastSeen) < 600;
}

function deviceMatchesEvent(dev: LanDevice, ev: UEvent): boolean {
  if (ev.src_ip && dev.ip === ev.src_ip) return true;
  if (ev.dest_ip && dev.ip === ev.dest_ip) return true;
  if (ev.mac && dev.mac.toLowerCase() === ev.mac.toLowerCase()) return true;
  return false;
}

function IoTGraphImpl() {
  const devicesMap = useStore((s) => s.devices);
  const events = useStore((s) => s.events);
  const reduce = useReducedMotion();
  const now = useNow(2000);
  const nowSec = Math.floor(now / 1000);
  const selectedMac = useStore((s) => s.selectedDevice);

  const devices = useMemo(() => Object.values(devicesMap), [devicesMap]);
  const positions = useMemo(() => layoutDevices(devices), [devices]);

  const recentEvents = useMemo(() => events.slice(0, 50), [events]);

  const litMacs = useMemo(() => {
    const set = new Set<string>();
    for (const ev of recentEvents) {
      for (const d of devices) {
        if (deviceMatchesEvent(d, ev)) set.add(d.mac);
      }
    }
    return set;
  }, [recentEvents, devices]);

  const selectedDev = selectedMac ? devicesMap[selectedMac] : null;
  const selectedEvents = useMemo(() => {
    if (!selectedDev) return [];
    return recentEvents.filter((ev) => deviceMatchesEvent(selectedDev, ev)).slice(0, 10);
  }, [selectedDev, recentEvents]);

  const onClickDevice = useCallback((mac: string) => {
    store.setSelectedDevice(store.getState().selectedDevice === mac ? null : mac);
  }, []);

  if (!devices.length) {
    return <div className="iot-empty empty">Awaiting ARP — no external devices observed</div>;
  }

  return (
    <div className="iot-wrap">
      <svg className="iot-svg" viewBox="0 0 600 360" role="img" aria-label="IoT device topology">
        {/* Router hub */}
        <rect x={CX - 40} y={CY - 16} width={80} height={32} rx={4}
          fill="var(--panel-2)" stroke="var(--muted)" strokeWidth={1.5} />
        <text x={CX} y={CY + 4} textAnchor="middle"
          className="iot-label" style={{ fontSize: 9 }}>ROUTER</text>

        {/* Pi3a observer */}
        <rect x={CX - 36} y={CY + 30} width={72} height={22} rx={3}
          fill="var(--panel-2)" stroke="var(--accent-line)" strokeWidth={1} strokeDasharray="3 2" />
        <text x={CX} y={CY + 44} textAnchor="middle"
          className="iot-label" style={{ fontSize: 8, fill: "var(--accent)" }}>Pi3a OBSERVER</text>

        {/* Edges to router */}
        {positions.map((p) => (
          <line key={`edge-${p.dev.mac}`}
            x1={CX} y1={CY} x2={p.x} y2={p.y}
            stroke={litMacs.has(p.dev.mac) ? "var(--accent)" : "var(--border)"}
            strokeWidth={litMacs.has(p.dev.mac) ? 1.5 : 0.8}
            opacity={litMacs.has(p.dev.mac) ? 0.8 : 0.3} />
        ))}

        {/* Device nodes */}
        {positions.map((p) => {
          const isNew = isRecentJoin(p.dev, nowSec);
          const isUnknown = p.dev.known === false;
          const isLit = litMacs.has(p.dev.mac);
          const isSelected = selectedMac === p.dev.mac;
          return (
            <g key={p.dev.mac} className="iot-node" onClick={() => onClickDevice(p.dev.mac)}
              tabIndex={0} role="button" aria-pressed={isSelected}
              aria-label={`${p.dev.vendor || "Unknown vendor"} ${p.dev.ip || ""}${isUnknown ? ", unknown device" : ""}`}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClickDevice(p.dev.mac); } }}>
              <rect x={p.x - 38} y={p.y - 20} width={76} height={40} rx={4}
                fill={isSelected ? "var(--accent-weak)" : "var(--panel-2)"}
                stroke={isUnknown ? "var(--yellow)" : isLit ? "var(--accent)" : "var(--border)"}
                strokeWidth={isSelected ? 2 : isUnknown ? 1.5 : 1}
                strokeDasharray={isUnknown ? "4 2" : "none"} />
              {isUnknown && (
                <path className="iot-unknown-mark" d={`M${p.x - 32} ${p.y - 20}l6 6-6 6-6-6z`}>
                  <title>Unknown device</title>
                </path>
              )}
              {isNew && !reduce && (
                <circle className="iot-new-dot" cx={p.x + 32} cy={p.y - 14} r={4} fill="var(--accent)" />
              )}
              <text x={p.x} y={p.y - 6} textAnchor="middle" className="iot-label"
                style={{ fontSize: 8 }}>{p.dev.vendor || "unknown"}</text>
              <text x={p.x} y={p.y + 4} textAnchor="middle" className="iot-label"
                style={{ fontSize: 7, fill: "var(--muted)" }}>{p.dev.ip || "—"}</text>
              <text x={p.x} y={p.y + 13} textAnchor="middle" className="iot-label"
                style={{ fontSize: 7, fill: "var(--muted-2)" }}>{shortMac(p.dev.mac)}</text>
            </g>
          );
        })}
      </svg>

      {/* Side detail card */}
      {selectedDev && (
        <div className="iot-detail">
          <div className="iot-detail-hd">
            <span className="iot-detail-vendor">{selectedDev.vendor || "Unknown"}</span>
            <button className="iot-detail-close" aria-label="Close device details" onClick={() => store.setSelectedDevice(null)}>×</button>
          </div>
          <div className="iot-detail-row"><span className="k">IP</span><span>{selectedDev.ip || "—"}</span></div>
          <div className="iot-detail-row"><span className="k">MAC</span><span className="num">{selectedDev.mac}</span></div>
          <div className="iot-detail-row"><span className="k">Known</span><span>{selectedDev.known ? "yes" : "no"}</span></div>
          <div className="iot-detail-row"><span className="k">First seen</span><span className="num">{selectedDev.firstSeen ? utcTime(selectedDev.firstSeen) : "—"}</span></div>
          <div className="iot-detail-row"><span className="k">Last seen</span><span className="num">{selectedDev.lastSeen ? utcTime(selectedDev.lastSeen) : "—"}</span></div>
          {selectedEvents.length > 0 && (
            <>
              <div className="label iot-detail-sub">Recent events</div>
              {selectedEvents.map((ev) => (
                <div key={ev.id} className={`iot-detail-ev sev-${ev.sev}`}>
                  <span className="num">{utcTime(ev.ts)}</span>
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

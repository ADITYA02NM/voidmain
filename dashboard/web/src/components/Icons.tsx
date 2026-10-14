import { memo } from "react";

// 16x16 grid, 1.5 stroke, round joins, currentColor. Stroked = kind, filled = severity.
const KIND_PATHS: Record<string, JSX.Element> = {
  // bell
  alert: <><path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3z" /><path d="M6.5 14h3" /></>,
  // shield
  suricata: <><path d="M8 1.75 13 3.5v4.25c0 3-2.2 5.2-5 6.5-2.8-1.3-5-3.5-5-6.5V3.5z" /><path d="M5.75 8 7.25 9.5 10.5 6.25" /></>,
  // radio arcs
  wifi: <><path d="M2 6.5a8.5 8.5 0 0 1 12 0" /><path d="M4.25 9a5.25 5.25 0 0 1 7.5 0" /><path d="M6.5 11.5a2 2 0 0 1 3 0" /><path d="M8 13.75h.01" /></>,
  // three linked nodes
  lan: <><rect x="6" y="1.75" width="4" height="3.5" /><rect x="1.75" y="10.75" width="4" height="3.5" /><rect x="10.25" y="10.75" width="4" height="3.5" /><path d="M8 5.25V8M3.75 10.75V8h8.5v2.75" /></>,
  // lid lifting off a box
  tripwire: <><path d="M2.5 8.5h11v5h-11z" /><path d="M3 6 12.5 2.5" /><path d="M8 10.5v1" /></>,
  // ascending steps
  band: <><path d="M2.5 13.5v-3M6 13.5V8M9.5 13.5V5.5M13 13.5v-11" /></>,
};

const KIND_NAME: Record<string, string> = {
  alert: "Alert", suricata: "IDS (Suricata)", wifi: "Wi-Fi", lan: "LAN", tripwire: "Tripwire", band: "Band change",
};

export const KindIcon = memo(function KindIcon({ kind }: { kind: string }) {
  const name = KIND_NAME[kind] ?? kind;
  return (
    <svg className="icon ev-kind" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={name}>
      <title>{name}</title>
      {KIND_PATHS[kind] ?? <circle cx="8" cy="8" r="1.5" />}
    </svg>
  );
});

// Distinct silhouettes per severity: circle < triangle < square < diamond.
const SEV_SHAPE: Record<string, { el: JSX.Element; name: string }> = {
  info: { el: <circle cx="8" cy="8" r="4.5" />, name: "Info" },
  green: { el: <circle cx="8" cy="8" r="4.5" />, name: "Low" },
  warn: { el: <path d="M8 2.5 13.5 12.5h-11z" />, name: "Warning" },
  yellow: { el: <path d="M8 2.5 13.5 12.5h-11z" />, name: "Elevated" },
  red: { el: <rect x="3" y="3" width="10" height="10" />, name: "High" },
  critical: { el: <rect x="3" y="3" width="10" height="10" />, name: "Critical" },
  purple: { el: <path d="M8 1.5 14.5 8 8 14.5 1.5 8z" />, name: "Critical" },
};

export const SevIcon = memo(function SevIcon({ sev }: { sev: string }) {
  const s = SEV_SHAPE[sev] ?? SEV_SHAPE.info!;
  return (
    <svg className={`icon sev-icon sev-${sev}`} viewBox="0 0 16 16" fill="currentColor"
      role="img" aria-label={`Severity: ${s.name}`}>
      <title>{s.name}</title>
      {s.el}
    </svg>
  );
});

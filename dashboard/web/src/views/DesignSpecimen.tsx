/**
 * Dev-only font specimen route (?design=specimen).
 * Compares two sans-serif candidates for the Intelligence Brief direction.
 * Excluded from production: guarded by import.meta.env.DEV in App.tsx.
 */
import { useState } from "react";
import type { Band } from "../contracts/ws";
import "./specimen.css";
import "./specimen-fonts.css";

const BANDS: Band[] = ["GREEN", "YELLOW", "RED", "PURPLE"];
const SCORE: Record<Band, number> = { GREEN: 12, YELLOW: 45, RED: 72, PURPLE: 92 };
const POSTURE: Record<Band, string> = {
  GREEN: "All quiet — passive watch.",
  YELLOW: "Elevated — dashboard highlight.",
  RED: "Active threat — email dispatched, operator notified.",
  PURPLE: "Critical — operator paged.",
};

interface FontOption {
  name: string;
  className: string;
  family: string;
  size: string;
  note: string;
}

const FONTS: FontOption[] = [
  {
    name: "Schibsted Grotesk",
    className: "font-schibsted",
    family: '"Schibsted Grotesk", system-ui, sans-serif',
    size: "subset 400–700: 32.9 KB",
    note: "Nordic origin, strong x-height, distinctive g/a/t. Less generic than Inter. OFL.",
  },
  {
    name: "IBM Plex Sans",
    className: "font-plex",
    family: '"IBM Plex Sans", system-ui, sans-serif',
    size: "subset 400–700: 21.2 KB",
    note: "IBM's open corporate type. Neutral, very well-hinted, excellent tabular figures. OFL.",
  },
];

function ScoringPanel({ score, band }: { score: number; band: Band }) {
  const R = 70, C = 2 * Math.PI * R, CX = 90, CY = 90;
  const offset = C * (1 - score / 100);
  return (
    <div className="sp-risk">
      <svg className="sp-ring" viewBox="0 0 180 180" width="120" height="120">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--sp-border)" strokeWidth="10" />
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--sp-accent)" strokeWidth="10"
          strokeLinecap="round" strokeDasharray={C} strokeDashoffset={offset}
          transform={`rotate(-90 ${CX} ${CY})`} />
      </svg>
      <div className="sp-read">
        <span className="sp-numeral">{score}</span>
        <span className="sp-of"> /100</span>
        <div className="sp-band">{band}</div>
        <div className="sp-posture">{POSTURE[band]}</div>
        <div className="sp-note">notify only — response is Phase 2</div>
      </div>
    </div>
  );
}

function EventRows({ band }: { band: Band }) {
  const events = [
    { label: "ALT", node: "ALR", sev: band === "PURPLE" ? "purple" : "red",
      time: "09:39:11", summary: "Suricata IDS hit — ET MALWARE beaconing detected on span port" },
    { label: "LAN", node: "DET", sev: "yellow",
      time: "09:38:06", summary: "Unknown device AA:BB:CC:DD:EE:FF (Espressif) — 192.168.100.50" },
    { label: "TRP", node: "DET", sev: "info",
      time: "09:38:19", summary: "Tripwire open on pi3a" },
  ];
  return (
    <div className="sp-events">
      {events.map((e, i) => (
        <div key={i} className={`sp-ev sev-${e.sev}`}>
          <span className="sp-ev-bar" />
          <span className="sp-ev-time">{e.time}</span>
          <span className={`sp-ev-node`}>{e.node}</span>
          <span className="sp-ev-kind">{e.label}</span>
          <span className="sp-ev-summary">{e.summary}</span>
        </div>
      ))}
    </div>
  );
}

function HeaderBar({ band }: { band: Band }) {
  return (
    <div className="sp-header">
      <span className="sp-wordmark">Void<b>Main</b></span>
      <span className="sp-live"><span className="sp-led" /> LIVE</span>
      <span className="sp-spacer" />
      <span className="sp-pill">{band}</span>
      <span className="sp-clock">09:41:38 UTC</span>
      <span className="sp-tag">MONITOR</span>
    </div>
  );
}

function TypeSpecimen() {
  return (
    <div className="sp-type">
      <div className="sp-type-row">
        <span className="sp-role">display</span>
        <span className="sp-type-display">72</span>
      </div>
      <div className="sp-type-row">
        <span className="sp-role">title</span>
        <span className="sp-type-title">Risk Assessment</span>
      </div>
      <div className="sp-type-row">
        <span className="sp-role">body</span>
        <span className="sp-type-body">Active threat — email dispatched, operator notified.</span>
      </div>
      <div className="sp-type-row">
        <span className="sp-role">label</span>
        <span className="sp-type-label">SCORING</span>
      </div>
      <div className="sp-type-row">
        <span className="sp-role">data-lg</span>
        <span className="sp-type-data-lg">41<span className="sp-unit">ms</span></span>
      </div>
      <div className="sp-type-row">
        <span className="sp-role">data</span>
        <span className="sp-type-data">192.168.100.1</span>
      </div>
      <div className="sp-type-row">
        <span className="sp-role">data-sm</span>
        <span className="sp-type-data-sm">09:41:38</span>
      </div>
      <div className="sp-type-row">
        <span className="sp-role">caption</span>
        <span className="sp-type-caption">Ctrl+K to focus · Tab to complete</span>
      </div>
    </div>
  );
}

function FontCard({ font, band }: { font: FontOption; band: Band }) {
  return (
    <div className={`sp-direction dir-intel ${font.className}`} data-band={band}>
      <div className="sp-dir-meta">
        <h2 className="sp-dir-name">{font.name}</h2>
        <p className="sp-dir-mood">{font.note}</p>
        <div className="sp-dir-fonts">
          <strong>Stack:</strong> Newsreader (titles) + {font.name} (UI) + JetBrains Mono (data)
        </div>
        <div className="sp-dir-proportion">
          <strong>woff2:</strong> {font.size} · Newsreader 400+700+italic: 57.8 KB · JetBrains Mono: 22.5 KB
        </div>
      </div>
      <HeaderBar band={band} />
      <ScoringPanel score={SCORE[band]} band={band} />
      <EventRows band={band} />
      <TypeSpecimen />
    </div>
  );
}

export default function DesignSpecimen() {
  const [activeBand, setActiveBand] = useState<Band>("RED");

  return (
    <div className="sp-page">
      <div className="sp-controls">
        <h1 className="sp-title">VoidMain Font Specimen — Intelligence Brief</h1>
        <div className="sp-band-switch">
          {BANDS.map(b => (
            <button key={b} className={`sp-band-btn ${activeBand === b ? "active" : ""}`}
              onClick={() => setActiveBand(b)}>
              {b}
            </button>
          ))}
        </div>
      </div>
      <div className="sp-grid sp-grid-2">
        {FONTS.map(f => <FontCard key={f.name} font={f} band={activeBand} />)}
      </div>
    </div>
  );
}

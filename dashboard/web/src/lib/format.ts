export function utcClock(d = new Date()): string {
  return d.toISOString().slice(11, 19);
}

export function utcTime(ts?: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toISOString().slice(11, 19) + " UTC";
}

export function ago(ts: number | undefined, nowMs: number): string {
  if (!ts) return "—";
  // ts is seconds since epoch, possibly with ms precision (float) -> floor the gap.
  const s = Math.max(0, Math.floor(nowMs / 1000 - ts));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

export function uptime(s: number | undefined): string {
  if (s == null) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

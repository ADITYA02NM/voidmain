// Dev render counter (works in production builds, unlike Profiler.onRender).
// Increments only when window.__ultronRC exists (set by ?perf=1); else ~free.
export function rc(name: string): void {
  const g = (window as unknown as { __ultronRC?: Record<string, number> }).__ultronRC;
  if (g) g[name] = (g[name] || 0) + 1;
}

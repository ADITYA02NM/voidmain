// Dev render counter (works in production builds, unlike Profiler.onRender).
// Increments only when window.__voidmainRC exists (set by ?perf=1); else ~free.
export function rc(name: string): void {
  const g = (window as unknown as { __voidmainRC?: Record<string, number> }).__voidmainRC;
  if (g) g[name] = (g[name] || 0) + 1;
}

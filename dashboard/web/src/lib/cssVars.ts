// Canvas can't use var(); read tokens once per band and cache.
let cacheBand: string | undefined;
const cache = new Map<string, string>();

export function cssVar(name: string): string {
  const band = document.documentElement.dataset.band;
  if (band !== cacheBand) {
    cache.clear();
    cacheBand = band;
  }
  let v = cache.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    cache.set(name, v);
  }
  return v;
}

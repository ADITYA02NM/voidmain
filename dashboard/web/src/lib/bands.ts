import type { Band } from "../contracts/ws";

// Band edges (dashboard.md §3 / architecture §5) + hysteresis +2 to match the
// risk engine exactly (no flicker at 29/30).
export const EDGES: Record<Band, number> = { GREEN: 0, YELLOW: 30, RED: 60, PURPLE: 85 };
const ORDER: Band[] = ["GREEN", "YELLOW", "RED", "PURPLE"];
const LOWER: Record<Band, number> = { GREEN: -Infinity, YELLOW: 30, RED: 60, PURPLE: 85 };
const UPPER: Record<Band, number> = { GREEN: 30, YELLOW: 60, RED: 85, PURPLE: Infinity };

export function bandForScore(v: number): Band {
  if (v >= 85) return "PURPLE";
  if (v >= 60) return "RED";
  if (v >= 30) return "YELLOW";
  return "GREEN";
}

/** Apply +2 hysteresis relative to the current band to avoid boundary flapping. */
export function bandWithHysteresis(v: number, current: Band): Band {
  const H = 2;
  // Stay in current band unless we cross its boundary by more than H.
  if (v >= LOWER[current] - (current === "GREEN" ? 0 : 0) && v < UPPER[current]) {
    // still inside; but check we didn't drop below lower - H
    if (v >= LOWER[current] - H) return current;
  }
  if (v >= UPPER[current] + H || v < LOWER[current] - H) return bandForScore(v);
  return current;
}

export function bandRank(b: Band): number {
  return ORDER.indexOf(b);
}

export function isWorse(next: Band, prev: Band): boolean {
  return bandRank(next) > bandRank(prev);
}

export const POSTURE: Record<Band, string> = {
  GREEN: "All quiet — passive watch.",
  YELLOW: "Elevated — dashboard highlight.",
  RED: "Active threat — email dispatched, operator notified.",
  PURPLE: "Critical — operator paged.",
};

// LED pattern per band, mirroring the ESP32-C3 WS2812B firmware.
export const LED_PATTERN: Record<Band, "solid" | "chase" | "strobe" | "pulse"> = {
  GREEN: "solid", YELLOW: "chase", RED: "strobe", PURPLE: "pulse",
};

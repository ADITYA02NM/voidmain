import { describe, it, expect } from "vitest";

// WCAG 2.1 relative luminance from sRGB hex.
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function sRGBtoLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(sRGBtoLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Token values (sRGB fallbacks from tokens.css)
const BG = "#100e0c";
const PANEL = "#1a1714";
const TEXT = "#ddd4c8";
const MUTED = "#9a8e80";
const MUTED2 = "#6e6050";

const GREEN = "#3ac870";
const YELLOW = "#d4b030";
const RED = "#d04838";
const PURPLE = "#a060d0";

const BANDS = { GREEN, YELLOW, RED, PURPLE };

describe("WCAG contrast ratios", () => {
  it("body text on --bg >= 4.5:1", () => {
    const ratio = contrast(TEXT, BG);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("body text on --panel >= 4.5:1", () => {
    const ratio = contrast(TEXT, PANEL);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("--muted on --bg >= 4.5:1", () => {
    const ratio = contrast(MUTED, BG);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("--muted on --panel >= 4.5:1", () => {
    const ratio = contrast(MUTED, PANEL);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("--muted-2 on --bg >= 3:1 (large text / UI)", () => {
    const ratio = contrast(MUTED2, BG);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });

  for (const [name, color] of Object.entries(BANDS)) {
    it(`${name} accent on --panel >= 3:1 (UI/large text)`, () => {
      const ratio = contrast(color, PANEL);
      expect(ratio).toBeGreaterThanOrEqual(3);
    });

    it(`${name} accent on --bg >= 3:1 (UI/large text)`, () => {
      const ratio = contrast(color, BG);
      expect(ratio).toBeGreaterThanOrEqual(3);
    });

    it(`${name} pill text (--bg on accent) >= 3:1`, () => {
      const ratio = contrast(BG, color);
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  }
});

import { describe, it, expect } from "vitest";
// @ts-expect-error plain .mjs script, no type declarations
import { checkTokens } from "../scripts/check-tokens.mjs";

describe("token lint", () => {
  const v = checkTokens() as Record<"hex" | "rgb" | "px" | "ms", string[]>;

  it("no raw durations outside tokens.css", () => {
    expect(v.ms, v.ms.join("\n")).toHaveLength(0);
  });

  it("no raw hex colours outside tokens.css", () => {
    expect(v.hex, v.hex.join("\n")).toHaveLength(0);
  });

  it("no raw rgb()/rgba() outside tokens.css", () => {
    expect(v.rgb, v.rgb.join("\n")).toHaveLength(0);
  });

  it("no raw px except 0/1px/2px outside tokens.css (OLED canvas, @media exempt)", () => {
    expect(v.px, v.px.join("\n")).toHaveLength(0);
  });
});

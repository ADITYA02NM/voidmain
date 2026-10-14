// Fails if raw colours or px values appear in component CSS/TSX outside tokens.css.
// Usage: node scripts/check-tokens.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// tokens.css defines the values; specimen files are the dev-only comparison page.
const EXEMPT = new Set(["styles/tokens.css", "views/specimen.css", "views/DesignSpecimen.tsx"]);

// Documented exceptions (printed by the CLI):
export const EXCEPTIONS = [
  "0 / 1px / 2px: zero, hairline borders, focus-ring width and thin bars",
  "components/IndicatorTwin.tsx px: canvas geometry addresses physical SSD1306 128x64 OLED pixels",
  "HardwareTwin.tsx / IoTGraph.tsx: SVG viewBox user units (unitless attributes, not px)",
  "@media breakpoints: CSS custom properties cannot be used inside media queries",
  "tokens.css, specimen.css, DesignSpecimen.tsx: token definitions and the dev-only specimen",
];
const PX_EXEMPT = new Set(["components/IndicatorTwin.tsx"]);
const PX_ALLOWED = new Set(["0px", "1px", "2px"]);

const RULES = [
  { name: "hex", re: /#(?:[0-9a-fA-F]{3,4}){1,2}\b/g },
  { name: "rgb", re: /\brgba?\s*\(\s*\d/g },
  { name: "px", re: /(?<![\w.])-?\d*\.?\d+px\b/g },
  { name: "ms", re: /(?<![\w.])\d*\.?\d+m?s\b(?=[\s;,)"'`])/g },
];

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".tsx", ".css"].includes(extname(full))) out.push(full);
  }
  return out;
}

export function checkTokens() {
  const violations = { hex: [], rgb: [], px: [], ms: [] };
  for (const f of walk(SRC)) {
    const rel = relative(SRC, f).replace(/\\/g, "/");
    if (EXEMPT.has(rel)) continue;
    const lines = readFileSync(f, "utf-8").split("\n");
    lines.forEach((line, i) => {
      const t = line.trimStart();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      for (const { name, re } of RULES) {
        if (name === "px" && (PX_EXEMPT.has(rel) || t.startsWith("@media"))) continue;
        // In TS/TSX only styling contexts count; "2s ago" / "41ms" are display text.
        if (name === "ms" && !rel.endsWith(".css") && !/transition|animation|\bdur=/.test(line)) continue;
        for (const m of line.match(re) ?? []) {
          if (name === "px" && PX_ALLOWED.has(m.replace("-", ""))) continue;
          violations[name].push(`${rel}:${i + 1}: ${m}`);
        }
      }
    });
  }
  return violations;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const v = checkTokens();
  let bad = 0;
  for (const [k, list] of Object.entries(v)) {
    console.log(`${k}: ${list.length} violation(s)`);
    for (const l of list) console.log("  " + l);
    bad += list.length;
  }
  console.log("exceptions:");
  for (const e of EXCEPTIONS) console.log("  - " + e);
  process.exit(bad ? 1 : 0);
}

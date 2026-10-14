"""Subset and instance the self-hosted fonts into src/assets/fonts/.

Sources are Fontsource's Latin woff2 files (OFL). Run: python scripts/build-fonts.py
Requires: fonttools, brotli.
"""
import io
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WEB = Path(__file__).resolve().parent.parent
SRC = WEB / "node_modules" / "@fontsource-variable"
OUT = WEB / "src" / "assets" / "fonts"

# Basic Latin + Latin-1 + the punctuation/symbols the UI actually renders.
UNICODES = (
    list(range(0x20, 0x7F)) + [c for c in range(0xA0, 0x100) if c != 0xAD]  # no soft hyphen
    + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026,
       0x2192, 0x2212, 0x25B6]
)
ASCII_PLUS = list(range(0x20, 0x7F)) + [0xB1, 0xB7, 0xD7, 0x2014, 0x2026, 0x2192, 0x2212, 0x25B6]

# (output name, source file, wght: range tuple for variable or int for static, unicodes)
PLAN = [
    ("newsreader-400.woff2", "newsreader/files/newsreader-latin-wght-normal.woff2", 400, UNICODES),
    ("newsreader-700.woff2", "newsreader/files/newsreader-latin-wght-normal.woff2", 700, UNICODES),
    ("newsreader-italic-400.woff2", "newsreader/files/newsreader-latin-wght-italic.woff2", 400, UNICODES),
    ("schibsted-grotesk-var.woff2", "schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2", (400, 700), UNICODES),
    ("ibm-plex-sans-var.woff2", "ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2", (400, 700), UNICODES),
    ("jetbrains-mono-var.woff2", "jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2", (400, 700), ASCII_PLUS),
]


def build(name, src, wght, unicodes):
    # Round-trip woff2 -> ttf so the transformed glyf table is fully decoded.
    buf = io.BytesIO()
    src_font = TTFont(SRC / src, lazy=False)
    src_font.flavor = None
    src_font.save(buf)
    buf.seek(0)
    font = TTFont(buf, lazy=False)
    limits = {"wght": wght if isinstance(wght, int) else instancer.AxisTriple(wght[0], wght[0], wght[1])}
    font = instancer.instantiateVariableFont(font, limits, updateFontNames=False)
    if "gvar" in font:  # some sources omit gvar entries for non-varying glyphs
        var = font["gvar"].variations
        for g in font.getGlyphOrder():
            var.setdefault(g, [])
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["kern", "liga", "tnum", "zero", "ss01", "calt"]
    opts.name_IDs = [1, 2]
    opts.notdef_glyph = False  # Fontsource sources ship without .notdef
    opts.hinting = False
    opts.desubroutinize = True
    s = subset.Subsetter(opts)
    s.populate(unicodes=unicodes)
    s.subset(font)
    out = OUT / name
    font.flavor = "woff2"
    font.save(out)
    return out.stat().st_size


# family, fallback name, local() names (metric-compatible pairs), fallback file for metrics,
# [(file, weight descriptor, style)]
FACES = [
    ("Newsreader", ["Times New Roman", "Liberation Serif"], "times.ttf",
     [("newsreader-400.woff2", "400", "normal"), ("newsreader-700.woff2", "700", "normal"),
      ("newsreader-italic-400.woff2", "400", "italic")]),
    ("Schibsted Grotesk", ["Arial", "Liberation Sans"], "arial.ttf",
     [("schibsted-grotesk-var.woff2", "400 700", "normal")]),
    ("JetBrains Mono", ["Courier New", "Liberation Mono"], "cour.ttf",
     [("jetbrains-mono-var.woff2", "400 700", "normal")]),
]
# Dev-only specimen candidate; emitted separately so production never references it.
SPECIMEN_FACES = [
    ("IBM Plex Sans", ["Arial", "Liberation Sans"], "arial.ttf",
     [("ibm-plex-sans-var.woff2", "400 700", "normal")]),
]
SAMPLE = "The quick brown fox jumps over the lazy dog 0123456789 ULTRON risk band"


def _width(font, text):
    cmap, hmtx = font.getBestCmap(), font["hmtx"]
    return sum(hmtx[cmap[ord(c)]][0] for c in text if ord(c) in cmap) / font["head"].unitsPerEm


def fallback_rule(family, locals_, fallback_file, web_file):
    web = TTFont(OUT / web_file)
    fb = TTFont(Path("C:/Windows/Fonts") / fallback_file) if sys.platform == "win32" \
        else TTFont(Path("/usr/share/fonts") / fallback_file)
    size = _width(web, SAMPLE) / _width(fb, SAMPLE)
    upm, hhea = web["head"].unitsPerEm, web["hhea"]
    pct = lambda v: f"{abs(v) / upm / size * 100:.2f}%"
    src = ", ".join(f'local("{n}")' for n in locals_)
    return (f'@font-face {{\n  font-family: "{family} Fallback";\n  src: {src};\n'
            f"  size-adjust: {size * 100:.2f}%;\n  ascent-override: {pct(hhea.ascent)};\n"
            f"  descent-override: {pct(hhea.descent)};\n  line-gap-override: {pct(hhea.lineGap)};\n}}\n")


def css(faces, url_prefix):
    out = []
    for family, locals_, fb_file, files in faces:
        for f, w, st in files:
            out.append(f'@font-face {{\n  font-family: "{family}";\n  src: url("{url_prefix}{f}") format("woff2");\n'
                       f"  font-weight: {w};\n  font-style: {st};\n  font-display: swap;\n}}\n")
        out.append(fallback_rule(family, locals_, fb_file, files[0][0]))
    return "\n".join(out)


HEADER = "/* Generated by scripts/build-fonts.py — do not edit. Subset, self-hosted, OFL. */\n\n"

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, src, wght, uni in PLAN:
        size = build(name, src, wght, uni)
        prod = not name.startswith("ibm-plex")
        total += size if prod else 0
        print(f"{size / 1024:6.1f} KB  {name}{'' if prod else '  (specimen only)'}")
    print(f"{total / 1024:6.1f} KB  production total")
    (WEB / "src" / "styles" / "fonts.css").write_text(HEADER + css(FACES, "../assets/fonts/"), encoding="utf-8")
    (WEB / "src" / "views" / "specimen-fonts.css").write_text(
        HEADER + css(SPECIMEN_FACES, "../assets/fonts/"), encoding="utf-8")

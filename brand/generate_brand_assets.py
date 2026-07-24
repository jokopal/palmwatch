"""
brand/generate_brand_assets.py
==============================
Generator aset logo PalmWatch / Pranata Bhumi.

Logomark  : Direction A "Presisi" (heksagon blok kebun + titik survei)
Warna     : Direction B "Kanopi"  (#14361F #5FA83F #9BCB4F #8A5A34 #F1F5EC)
Tipografi : Space Grotesk (di-outline jadi <path> — SVG tidak butuh font)

Menghasilkan (di brand/svg dan brand/png):
  - logomark ............ ikon saja (tanpa teks)
  - horizontal .......... ikon + "PalmWatch"
  - horizontal-tagline .. ikon + "PalmWatch" + "by Pranata Bhumi"
  - vertical ............ ikon di atas, teks di bawah (rata tengah)
  - pranata-horizontal .. ikon + "Pranata Bhumi" + "CONSULTING"
masing-masing dalam 4 varian warna: primary / reversed / mono-dark / mono-white

Jalankan:  python brand/generate_brand_assets.py
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent
SVG_DIR = ROOT / "svg"
PNG_DIR = ROOT / "png"
FONT_BOLD = ROOT / "_fonts" / "SpaceGrotesk-Bold.ttf"
FONT_MED = ROOT / "_fonts" / "SpaceGrotesk-Medium.ttf"

# ── Palet Direction B "Kanopi" ───────────────────────────────────────────────
FOREST = "#14361F"
CANOPY = "#5FA83F"
LIME = "#9BCB4F"
WHITE = "#FFFFFF"
MUTED = "#5F7A55"

# varian: (mark, dot, pin|None, text, sub)
VARIANTS = {
    "primary":    (FOREST, CANOPY, WHITE, FOREST, MUTED),   # untuk latar terang
    "reversed":   (LIME,   LIME,   WHITE, WHITE,  LIME),    # untuk latar gelap
    "mono-dark":  (FOREST, FOREST, None,  FOREST, FOREST),  # satu warna gelap
    "mono-white": (WHITE,  WHITE,  None,  WHITE,  WHITE),   # satu warna putih
}

# ── Geometri logomark (viewBox 56×56, identik dengan yang dipakai app) ───────
HEX = [(28, 4), (50, 16), (50, 40), (28, 52), (6, 40), (6, 16)]
CROSSHAIR = [((28, 4), (28, 52)), ((6, 16), (50, 40)), ((50, 16), (6, 40))]
HEX_W = 2.5          # tebal garis heksagon
CH_W = 1.0           # tebal crosshair
CH_OPACITY = 0.35
DOT_R = 4.5
PIN_R = 2.0
MARK = 56.0          # ukuran kanvas logomark

# ── Konstanta layout lockup (dipakai bersama SVG & PNG agar tidak drift) ────
V = dict(fs=26.0, ss=8.5, tr=1.6, title_bl=MARK + 26, sub_bl=MARK + 42, h=MARK + 48)


# ── Teks → path SVG (outline, tanpa ketergantungan font) ────────────────────
def text_paths(ttf: Path, text: str, size: float, tracking: float = 0.0):
    """Kembalikan (list<path d>, total_width). Baseline di y=0, y SVG ke bawah."""
    font = TTFont(str(ttf))
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    hmtx = font["hmtx"]
    scale = size / upm
    x, out = 0.0, []
    for ch in text:
        gname = cmap.get(ord(ch))
        if gname is None:
            x += size * 0.35 + tracking
            continue
        pen = SVGPathPen(glyphs)
        glyphs[gname].draw(pen)
        d = pen.getCommands()
        if d:
            out.append(
                f'<path d="{d}" transform="translate({x:.2f},0) scale({scale:.6f},{-scale:.6f})"/>'
            )
        x += hmtx[gname][0] * scale + tracking
    if text:
        x -= tracking
    return out, x


def text_width(ttf: Path, text: str, size: float, tracking: float = 0.0) -> float:
    return text_paths(ttf, text, size, tracking)[1]


# ── Bangun logomark sebagai potongan SVG ────────────────────────────────────
def mark_svg(mark_c: str, dot_c: str, pin_c: str | None, tx=0.0, ty=0.0, scale=1.0) -> str:
    pts = " ".join(f"{x},{y}" for x, y in HEX)
    lines = "".join(
        f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}" stroke="{mark_c}" '
        f'stroke-width="{CH_W}" stroke-opacity="{CH_OPACITY}"/>'
        for a, b in CROSSHAIR
    )
    pin = f'<circle cx="28" cy="28" r="{PIN_R}" fill="{pin_c}"/>' if pin_c else ""
    return (
        f'<g transform="translate({tx:.2f},{ty:.2f}) scale({scale:.5f})">'
        f'<polygon points="{pts}" fill="none" stroke="{mark_c}" stroke-width="{HEX_W}" '
        f'stroke-linejoin="miter"/>{lines}'
        f'<circle cx="28" cy="28" r="{DOT_R}" fill="{dot_c}"/>{pin}</g>'
    )


def svg_doc(w: float, h: float, body: str, title: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.2f} {h:.2f}" '
        f'width="{w:.2f}" height="{h:.2f}" fill="none" role="img" aria-label="{title}">'
        f"<title>{title}</title>{body}</svg>\n"
    )


def text_group(ttf: Path, s: str, size: float, x: float, baseline: float,
               color: str, tracking: float = 0.0) -> tuple[str, float]:
    paths, w = text_paths(ttf, s, size, tracking)
    g = (f'<g transform="translate({x:.2f},{baseline:.2f})" fill="{color}">'
         + "".join(paths) + "</g>")
    return g, w


# ── Definisi tiap aset (mengembalikan svg string + ukuran) ──────────────────
def build_logomark(v) -> tuple[str, float, float]:
    m, d, p, _, _ = v
    return svg_doc(MARK, MARK, mark_svg(m, d, p), "PalmWatch logomark"), MARK, MARK


def build_horizontal(v) -> tuple[str, float, float]:
    m, d, p, t, _ = v
    gap, fs = 18.0, 30.0
    tw = text_width(FONT_BOLD, "PalmWatch", fs)
    w, h = MARK + gap + tw, MARK
    g, _ = text_group(FONT_BOLD, "PalmWatch", fs, MARK + gap, 38.5, t)
    return svg_doc(w, h, mark_svg(m, d, p) + g, "PalmWatch"), w, h


def build_horizontal_tagline(v) -> tuple[str, float, float]:
    m, d, p, t, sub = v
    gap, fs, ss, tr = 18.0, 27.0, 9.0, 1.6
    tw = text_width(FONT_BOLD, "PalmWatch", fs)
    sw = text_width(FONT_MED, "by Pranata Bhumi", ss, tr)
    w, h = MARK + gap + max(tw, sw), MARK
    g1, _ = text_group(FONT_BOLD, "PalmWatch", fs, MARK + gap, 30.0, t)
    g2, _ = text_group(FONT_MED, "by Pranata Bhumi", ss, MARK + gap, 45.0, sub, tr)
    return svg_doc(w, h, mark_svg(m, d, p) + g1 + g2, "PalmWatch by Pranata Bhumi"), w, h


def build_vertical(v) -> tuple[str, float, float]:
    m, d, p, t, sub = v
    tw = text_width(FONT_BOLD, "PalmWatch", V["fs"])
    sw = text_width(FONT_MED, "by Pranata Bhumi", V["ss"], V["tr"])
    w, h = max(MARK, tw, sw), V["h"]
    g1, _ = text_group(FONT_BOLD, "PalmWatch", V["fs"], (w - tw) / 2, V["title_bl"], t)
    g2, _ = text_group(FONT_MED, "by Pranata Bhumi", V["ss"], (w - sw) / 2, V["sub_bl"], sub, V["tr"])
    return svg_doc(w, h, mark_svg(m, d, p, (w - MARK) / 2, 0) + g1 + g2,
                   "PalmWatch (vertical)"), w, h


def build_pranata(v) -> tuple[str, float, float]:
    m, d, p, t, sub = v
    gap, fs, ss, tr = 18.0, 26.0, 9.0, 3.0
    tw = text_width(FONT_BOLD, "Pranata Bhumi", fs)
    sw = text_width(FONT_MED, "CONSULTING", ss, tr)
    w, h = MARK + gap + max(tw, sw), MARK
    g1, _ = text_group(FONT_BOLD, "Pranata Bhumi", fs, MARK + gap, 29.0, t)
    g2, _ = text_group(FONT_MED, "CONSULTING", ss, MARK + gap, 44.0, sub, tr)
    return svg_doc(w, h, mark_svg(m, d, p) + g1 + g2, "Pranata Bhumi Consulting"), w, h


ASSETS = {
    "logomark": build_logomark,
    "horizontal": build_horizontal,
    "horizontal-tagline": build_horizontal_tagline,
    "vertical": build_vertical,
    "pranata-horizontal": build_pranata,
}


# ── Rasterisasi PNG (PIL, supersample 8× lalu downscale) ────────────────────
def hexrgb(c: str):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def draw_mark_pil(base: ImageDraw.ImageDraw, img: Image.Image, s: float,
                  ox: float, oy: float, mark_c, dot_c, pin_c):
    """Gambar logomark ke PIL. s = skala dari unit 56 ke piksel."""
    P = lambda x, y: (ox + x * s, oy + y * s)  # noqa: E731

    # Heksagon: ring dari dua poligon lewat mask → sudut miter tajam, tanpa
    # takik sambungan (draw.line closed menyisakan butt-cap di vertex awal).
    cx, cy = 28.0, 28.0
    apothem = ((39 - 28) ** 2 + (10 - 28) ** 2) ** 0.5  # center → titik tengah sisi
    def ring(f):
        return [P(cx + (x - cx) * f, cy + (y - cy) * f) for x, y in HEX]
    mask = Image.new("L", img.size, 0)
    md = ImageDraw.Draw(mask)
    md.polygon(ring(1 + (HEX_W / 2) / apothem), fill=255)   # tepi luar stroke
    md.polygon(ring(1 - (HEX_W / 2) / apothem), fill=0)     # lubang dalam
    img.paste(Image.new("RGBA", img.size, hexrgb(mark_c) + (255,)), (0, 0), mask)
    # crosshair 35% opacity → layer terpisah lalu composite
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for a, b in CROSSHAIR:
        od.line([P(*a), P(*b)], fill=hexrgb(mark_c) + (int(255 * CH_OPACITY),),
                width=max(1, round(CH_W * s)))
    img.alpha_composite(ov)
    d2 = ImageDraw.Draw(img)
    cx, cy = P(28, 28)
    r = DOT_R * s
    d2.ellipse([cx - r, cy - r, cx + r, cy + r], fill=hexrgb(dot_c))
    if pin_c:
        r2 = PIN_R * s
        d2.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=hexrgb(pin_c))


def render_png(kind: str, variant: str, v, out_w: int, path: Path):
    """Render aset ke PNG lebar out_w px (tinggi proporsional), latar transparan."""
    m, d, p, t, sub = v
    _, W, H = ASSETS[kind](v)
    SS = 8 if out_w <= 256 else 4                 # supersample
    px_per_unit = (out_w * SS) / W
    img = Image.new("RGBA", (round(W * px_per_unit), round(H * px_per_unit)), (0, 0, 0, 0))
    base = ImageDraw.Draw(img)

    def F(ttf, size):
        return ImageFont.truetype(str(ttf), max(1, round(size * px_per_unit)))

    def txt(s, x, baseline, ttf, size, color, tracking=0.0):
        f = F(ttf, size)
        cx = x * px_per_unit
        for ch in s:
            ImageDraw.Draw(img).text((cx, baseline * px_per_unit), ch,
                                     font=f, fill=hexrgb(color), anchor="ls")
            cx += f.getlength(ch) + tracking * px_per_unit

    if kind == "logomark":
        draw_mark_pil(base, img, px_per_unit, 0, 0, m, d, p)
    elif kind == "horizontal":
        draw_mark_pil(base, img, px_per_unit, 0, 0, m, d, p)
        txt("PalmWatch", MARK + 18, 38.5, FONT_BOLD, 30, t)
    elif kind == "horizontal-tagline":
        draw_mark_pil(base, img, px_per_unit, 0, 0, m, d, p)
        txt("PalmWatch", MARK + 18, 30.0, FONT_BOLD, 27, t)
        txt("by Pranata Bhumi", MARK + 18, 45.0, FONT_MED, 9, sub, 1.6)
    elif kind == "vertical":
        tw = text_width(FONT_BOLD, "PalmWatch", V["fs"])
        sw = text_width(FONT_MED, "by Pranata Bhumi", V["ss"], V["tr"])
        draw_mark_pil(base, img, px_per_unit, (W - MARK) / 2 * px_per_unit, 0, m, d, p)
        txt("PalmWatch", (W - tw) / 2, V["title_bl"], FONT_BOLD, V["fs"], t)
        txt("by Pranata Bhumi", (W - sw) / 2, V["sub_bl"], FONT_MED, V["ss"], sub, V["tr"])
    elif kind == "pranata-horizontal":
        draw_mark_pil(base, img, px_per_unit, 0, 0, m, d, p)
        txt("Pranata Bhumi", MARK + 18, 29.0, FONT_BOLD, 26, t)
        txt("CONSULTING", MARK + 18, 44.0, FONT_MED, 9, sub, 3.0)

    img = img.resize((out_w, max(1, round(out_w * H / W))), Image.LANCZOS)
    img.save(path)
    return img.size


def make_preview(path: Path) -> None:
    """Contact sheet: tiap lockup di latar yang sesuai (QA visual)."""
    rows = [
        ("primary", "#F1F5EC"), ("mono-dark", "#FFFFFF"),
        ("reversed", "#14361F"), ("mono-white", "#1D4E2C"),
    ]
    kinds = ["logomark", "horizontal", "horizontal-tagline", "vertical", "pranata-horizontal"]
    cell_w, pad, row_h = 300, 26, 150
    W = pad + len(kinds) * (cell_w + pad)
    H = pad + len(rows) * (row_h + pad)
    sheet = Image.new("RGB", (W, H), (255, 255, 255))
    for ri, (vname, bg) in enumerate(rows):
        y0 = pad + ri * (row_h + pad)
        ImageDraw.Draw(sheet).rectangle([0, y0 - pad // 2, W, y0 + row_h + pad // 2], fill=hexrgb(bg))
        for ki, kind in enumerate(kinds):
            src = PNG_DIR / f"palmwatch-{kind}-{vname}-{512 if kind != 'logomark' else 256}w.png"
            im = Image.open(src).convert("RGBA")
            sc = min((cell_w - 20) / im.width, (row_h - 20) / im.height)
            im = im.resize((max(1, int(im.width * sc)), max(1, int(im.height * sc))), Image.LANCZOS)
            x = pad + ki * (cell_w + pad) + (cell_w - im.width) // 2
            sheet.paste(im, (x, y0 + (row_h - im.height) // 2), im)
    sheet.save(path)


def main() -> None:
    for dirp in (SVG_DIR, PNG_DIR):
        dirp.mkdir(parents=True, exist_ok=True)

    # sizes per jenis aset (lebar px)
    sizes = {
        "logomark": [64, 128, 256, 512, 1024],
        "horizontal": [512, 1024, 2048],
        "horizontal-tagline": [512, 1024, 2048],
        "vertical": [512, 1024],
        "pranata-horizontal": [512, 1024, 2048],
    }

    n_svg = n_png = 0
    for kind, builder in ASSETS.items():
        for vname, v in VARIANTS.items():
            svg, W, H = builder(v)
            (SVG_DIR / f"palmwatch-{kind}-{vname}.svg").write_text(svg, encoding="utf-8")
            n_svg += 1
            for w in sizes[kind]:
                render_png(kind, vname, v, w,
                           PNG_DIR / f"palmwatch-{kind}-{vname}-{w}w.png")
                n_png += 1

    # Favicon set (logomark primary) + .ico multi-size
    fav = ROOT / "favicon"
    fav.mkdir(exist_ok=True)
    for s in (16, 32, 48, 64, 180, 192, 512):
        render_png("logomark", "primary", VARIANTS["primary"], s, fav / f"favicon-{s}.png")
        n_png += 1
    ico = Image.open(fav / "favicon-512.png")
    ico.save(fav / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    make_preview(ROOT / "preview.png")

    print(f"SVG : {n_svg} file  -> {SVG_DIR}")
    print(f"PNG : {n_png} file  -> {PNG_DIR} (+ favicon/)")
    print(f"QA  : {ROOT / 'preview.png'}")


if __name__ == "__main__":
    main()

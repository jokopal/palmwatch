"""Bangun overlay PNG untuk setiap raster, plus manifest untuk frontend.

LATAR BELAKANG
--------------
Sebelumnya raster digambar lewat @geomatico/maplibre-cog-protocol: browser
mengunduh potongan GeoTIFF, men-decode-nya, lalu mewarnai per piksel. Jalur itu
punya banyak titik gagal senyap (nama colormap tak dikenal, URL relatif, mask
global, range request) dan pada praktiknya raster tidak pernah tampil.

Seluruh raster proyek ini hanya berjumlah ~112.000 piksel — setara satu citra
334x334. Untuk data sekecil itu, men-decode GeoTIFF di browser adalah pekerjaan
sia-sia. Skrip ini memindahkan pewarnaan ke sisi build: tiap raster dirender
sekali menjadi PNG ber-alpha, lalu ditempel di peta memakai `image` source
bawaan MapLibre (URL + empat koordinat sudut). Tidak ada decoder, tidak ada
protokol, tidak ada range request — praktis mustahil gagal tampil.

Konsekuensi yang harus diterima: warna menjadi tetap. Mengganti skema warna
atau rentang nilai berarti menjalankan ulang skrip ini, bukan menggeser kontrol
di panel. Nilai piksel juga tidak bisa dibaca saat hover.

PEMAKAIAN
---------
    python scripts/build_raster_overlays.py              # dari DB + lokal
    python scripts/build_raster_overlays.py --local-only # tanpa akses DB

Keluaran:
    web/public/overlays/<slug>.png    gambar ber-alpha (nodata transparan)
    web/src/rasterOverlays.json       manifest: nama, bbox, legenda, kategori
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
import rasterio
from matplotlib import colormaps, colors
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_IMG = ROOT / "web" / "public" / "overlays"
OUT_MANIFEST = ROOT / "web" / "src" / "rasterOverlays.json"
LOCAL_COG_DIR = ROOT / "web" / "public" / "cogs"

# Raster dengan piksel sesedikit ini bukan peta — itu satu angka yang kebetulan
# disimpan sebagai raster. Menggambarnya hanya menghasilkan kotak datar raksasa.
MIN_PIXELS = 12

# Pilihan colormap matplotlib per kategori data. Dipakai juga untuk membangun
# gradien legenda, sehingga legenda dijamin sama dengan gambarnya.
CMAP_BY_CATEGORY = {
    "dem": "terrain",
    "soil": "YlOrBr",
    "rainfall": "Blues",
    "twi": "Blues",
    "ndvi": "YlGn",
    "drainage": "YlGnBu",
    "other": "viridis",
}

# Pencocokan berdasarkan nama — lebih spesifik daripada kategori. Diperiksa
# berurutan, jadi yang paling khas harus lebih dulu: "Slope / Drainase" adalah
# peta kemiringan, bukan peta drainase.
#
# Batas kata (\b) wajib untuk singkatan pendek. Tanpa itu "ph" ikut cocok
# dengan "Topographic" dan peta kebasahan diwarnai skema pH.
CMAP_BY_NAME = [
    (r"\bph\b", "RdYlGn"),
    (r"karbon|organik|\bsoc\b", "YlGn"),
    (r"ndvi|vegeta", "YlGn"),
    (r"slope|lereng|kemiring", "YlOrBr"),
    (r"\btwi\b|wetness|kebasahan", "Blues"),
    (r"\bhand\b|drainase|drainage|sungai|stream|flow|upstream", "YlGnBu"),
    (r"hujan|rain|curah", "Blues"),
    (r"liat|clay|pasir|sand|debu|silt|tekstur|bobot isi|tipe tanah", "YlOrBr"),
    (r"\bdem\b|elevasi|ortho|\bdsm\b|fabdem|demnas", "terrain"),
]

N_LEGEND_STOPS = 7


@dataclass
class Overlay:
    id: str
    name: str
    category: str
    image: str                       # URL relatif terhadap root web
    bounds: list[float]              # [minx, miny, maxx, maxy] EPSG:4326
    minValue: float
    maxValue: float
    colormap: str
    legend: list[str]                # warna hex, urut min -> max
    width: int
    height: int


def slugify(name: str) -> str:
    s = re.sub(r"[^\w\s-]", "", name, flags=re.UNICODE).strip().lower()
    return re.sub(r"[\s_-]+", "-", s)


def pick_cmap(name: str, category: str) -> str:
    low = name.lower()
    for pattern, cmap in CMAP_BY_NAME:
        if re.search(pattern, low):
            return cmap
    return CMAP_BY_CATEGORY.get((category or "other").lower(), "viridis")


def legend_stops(cmap_name: str) -> list[str]:
    cmap = colormaps[cmap_name]
    return [colors.to_hex(cmap(i / (N_LEGEND_STOPS - 1))) for i in range(N_LEGEND_STOPS)]


def render(src_path: str, name: str, category: str, out_dir: Path) -> Overlay | None:
    """Render satu raster jadi PNG ber-alpha. None bila tak layak digambar."""
    with rasterio.open(src_path) as src:
        if src.count < 1:
            print(f"  LEWAT  {name}: tidak punya band")
            return None
        if src.width * src.height < MIN_PIXELS:
            print(f"  LEWAT  {name}: hanya {src.width}x{src.height} piksel — bukan peta")
            return None

        band = src.read(1).astype("float64")
        nodata = src.nodata
        mask = np.isnan(band)
        if nodata is not None:
            mask |= band == nodata

        valid = band[~mask]
        if valid.size == 0:
            print(f"  LEWAT  {name}: seluruh piksel nodata")
            return None

        vmin, vmax = float(valid.min()), float(valid.max())
        if vmax - vmin < 1e-12:
            # Raster konstan: tetap digambar sebagai satu warna solid, tapi
            # rentang legendanya dilebarkan agar normalisasi tidak membagi nol.
            vmax = vmin + 1e-9

        cmap_name = pick_cmap(name, category)
        norm = colors.Normalize(vmin=vmin, vmax=vmax, clip=True)
        rgba = (colormaps[cmap_name](norm(band)) * 255).astype("uint8")
        rgba[..., 3] = np.where(mask, 0, 255)  # nodata -> transparan penuh

        out_dir.mkdir(parents=True, exist_ok=True)
        slug = slugify(name)
        Image.fromarray(rgba, "RGBA").save(out_dir / f"{slug}.png", optimize=True)

        b = src.bounds
        return Overlay(
            id=slug,
            name=name,
            category=(category or "other").lower(),
            image=f"/overlays/{slug}.png",
            bounds=[b.left, b.bottom, b.right, b.top],
            minValue=round(vmin, 4),
            maxValue=round(vmax, 4),
            colormap=cmap_name,
            legend=legend_stops(cmap_name),
            width=src.width,
            height=src.height,
        )


def sources_from_db() -> list[tuple[str, str, str]]:
    """(url, nama, kategori) dari tabel raster_layers. Kosong bila DB tak ada."""
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("SUPABASE_DB_URL tidak diset — melewati sumber database.")
        return []

    import psycopg2  # impor lokal agar mode --local-only tidak butuh psycopg2

    # Basis URL storage bisa berada di .env (SUPABASE_URL) atau di
    # web/.env.local (VITE_SUPABASE_URL) — terima keduanya.
    base = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or "").rstrip("/")
    if not base:
        print("SUPABASE_URL / VITE_SUPABASE_URL tidak diset — melewati sumber database.")
        return []

    out: list[tuple[str, str, str]] = []
    with psycopg2.connect(db_url) as conn, conn.cursor() as cur:
        cur.execute(
            "select name, storage_path, coalesce(category,'other') "
            "from public.raster_layers order by created_at desc"
        )
        for name, path, category in cur.fetchall():
            out.append(
                (f"{base}/storage/v1/object/public/rasters/{path}", name, category)
            )
    return out


def sources_from_local() -> list[tuple[str, str, str]]:
    if not LOCAL_COG_DIR.is_dir():
        return []
    out = []
    for f in sorted(LOCAL_COG_DIR.glob("*.tif")):
        nice = f.stem.replace("_", " ")
        out.append((str(f), nice, "other"))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--local-only", action="store_true",
                    help="hanya proses web/public/cogs, tanpa akses database")
    args = ap.parse_args()

    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
        load_dotenv(ROOT / "web" / ".env.local")  # VITE_SUPABASE_URL ada di sini
    except ImportError:
        pass

    sources = sources_from_local() if args.local_only else (
        sources_from_db() or sources_from_local()
    )
    if not sources:
        print("Tidak ada sumber raster yang ditemukan.", file=sys.stderr)
        return 1

    print(f"Memproses {len(sources)} raster -> {OUT_IMG}")
    overlays: list[Overlay] = []
    seen: set[str] = set()

    for url, name, category in sources:
        if name in seen:
            continue
        seen.add(name)
        try:
            ov = render(url, name, category, OUT_IMG)
        except Exception as exc:  # noqa: BLE001 - satu raster rusak tak boleh
            print(f"  GAGAL  {name}: {type(exc).__name__}: {exc}")  # menggagalkan sisanya
            continue
        if ov is None:
            continue
        overlays.append(ov)
        kb = (OUT_IMG / f"{ov.id}.png").stat().st_size / 1024
        print(f"  OK     {ov.name:<34} {ov.width}x{ov.height:<9} {kb:6.1f} KB  {ov.colormap}")

    overlays.sort(key=lambda o: (o.category, o.name))

    # Buang PNG yang tak lagi disebut manifest. Tanpa ini, raster yang dihapus
    # atau berganti nama meninggalkan berkas basi yang ikut ter-deploy.
    keep = {f"{o.id}.png" for o in overlays}
    for stale in sorted(OUT_IMG.glob("*.png")):
        if stale.name not in keep:
            stale.unlink()
            print(f"  HAPUS  {stale.name} (tidak ada di manifest)")

    OUT_MANIFEST.write_text(
        json.dumps([asdict(o) for o in overlays], indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    total_kb = sum((OUT_IMG / f"{o.id}.png").stat().st_size for o in overlays) / 1024
    print(f"\n{len(overlays)} overlay, total {total_kb:.1f} KB")
    print(f"Manifest: {OUT_MANIFEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

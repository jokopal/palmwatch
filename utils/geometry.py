"""
utils/geometry.py
=================
Pemuatan dan validasi geometri blok panen untuk pipeline PalmWatch.

`load_blocks` adalah titik masuk tunggal untuk membaca poligon blok dari
GeoJSON/Shapefile menjadi GeoDataFrame yang bersih dan konsisten:

- CRS dinormalisasi ke WGS84 (EPSG:4326) untuk penyimpanan (lihat context.md).
- `area_ha` dihitung ulang secara akurat memakai proyeksi equal-area global
  (EPSG:6933) agar tidak bergantung pada satuan derajat.
- `block_id` wajib ada dan unik.

Konvensi ini menjaga agar data yang masuk ke PostGIS/Supabase seragam apa pun
sumber file kliennya.
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd

from utils.logger import get_logger

log = get_logger("geometry")

# Proyeksi equal-area global (World Cylindrical Equal Area) untuk kalkulasi luas.
EQUAL_AREA_CRS = "EPSG:6933"
STORAGE_CRS = "EPSG:4326"

# Atribut opsional milik klien yang dipertahankan bila tersedia.
PASSTHROUGH_COLS = ("estate", "planting_year", "variety")


def load_blocks(path: str | Path) -> gpd.GeoDataFrame:
    """
    Muat poligon blok panen menjadi GeoDataFrame ternormalisasi.

    Args:
        path: Path ke GeoJSON / Shapefile berisi poligon blok. Wajib memiliki
              kolom `block_id`.

    Returns:
        GeoDataFrame dengan kolom minimal: block_id, area_ha, geometry
        (+ atribut passthrough yang tersedia), CRS = EPSG:4326.

    Raises:
        FileNotFoundError: file tidak ada.
        ValueError: file kosong, tanpa kolom block_id, atau block_id duplikat.
    """
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"File blok tidak ditemukan: {p}")

    gdf = gpd.read_file(p)
    if gdf.empty:
        raise ValueError(f"File blok kosong (0 fitur): {p}")

    if "block_id" not in gdf.columns:
        raise ValueError(
            f"Kolom 'block_id' wajib ada pada {p.name}. "
            f"Kolom tersedia: {list(gdf.columns)}"
        )

    # CRS: asumsikan WGS84 bila tidak terdefinisi, lalu proyeksikan ke 4326.
    if gdf.crs is None:
        log.warning("crs_missing_assuming_wgs84", file=p.name)
        gdf = gdf.set_crs(STORAGE_CRS)
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(STORAGE_CRS)

    gdf["block_id"] = gdf["block_id"].astype(str)
    dup = gdf["block_id"][gdf["block_id"].duplicated()].unique()
    if len(dup) > 0:
        raise ValueError(f"block_id duplikat pada {p.name}: {list(dup)}")

    # Luas akurat via proyeksi equal-area (m² -> ha).
    gdf["area_ha"] = (gdf.to_crs(EQUAL_AREA_CRS).area / 10_000.0).round(2)

    keep = ["block_id", "area_ha", *[c for c in PASSTHROUGH_COLS if c in gdf.columns], "geometry"]
    gdf = gdf[keep].set_geometry("geometry")

    log.info(
        "blocks_loaded",
        file=p.name,
        n_blocks=len(gdf),
        total_area_ha=round(float(gdf["area_ha"].sum()), 1),
    )
    return gdf

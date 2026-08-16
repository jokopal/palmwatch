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

try:
    import fiona
    if not hasattr(fiona, "path"):
        import fiona._path
        if not hasattr(fiona._path, "ParsedPath") and hasattr(fiona._path, "_ParsedPath"):
            fiona._path.ParsedPath = fiona._path._ParsedPath
        fiona.path = fiona._path
except ImportError:
    pass

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


# ─────────────────────────────────────────────────────────────────────────────
# GEE helpers (import ee ditunda agar modul ini tetap dapat diimpor tanpa GEE)
# ─────────────────────────────────────────────────────────────────────────────

def gdf_to_ee_featurecollection(gdf: gpd.GeoDataFrame) -> list:
    """
    Konversi GeoDataFrame blok → daftar ee.Feature (untuk ee.FeatureCollection).

    Tiap fitur membawa properti `block_id` sehingga hasil zonal-stats GEE dapat
    dipetakan balik ke blok. Geometri dianggap WGS84 (EPSG:4326), non-geodesic
    agar tepi poligon lurus (sesuai batas kebun).
    """
    import ee
    from shapely.geometry import mapping

    g = gdf if gdf.crs is None or gdf.crs.to_epsg() == 4326 else gdf.to_crs("EPSG:4326")
    features = []
    for _, row in g.iterrows():
        geom = ee.Geometry(mapping(row.geometry), "EPSG:4326", False)
        features.append(ee.Feature(geom, {"block_id": str(row["block_id"])}))
    return features


def bbox_from_gdf(gdf: gpd.GeoDataFrame):
    """Bounding box seluruh blok sebagai ee.Geometry.Rectangle (WGS84)."""
    import ee

    g = gdf if gdf.crs is None or gdf.crs.to_epsg() == 4326 else gdf.to_crs("EPSG:4326")
    minx, miny, maxx, maxy = (float(v) for v in g.total_bounds)
    return ee.Geometry.Rectangle([minx, miny, maxx, maxy], "EPSG:4326", False)

"""
processors/zonal_stats.py
==========================
Kalkulasi zonal statistics per blok polygon dari raster lokal.
Digunakan ketika data didownload lokal (bukan via GEE langsung).

Untuk pipeline utama, GEE sudah menangani zonal stats server-side.
Module ini digunakan untuk:
1. Data yang didownload via HTTP (CHIRPS tif, SoilGrids tif)
2. Validasi silang hasil GEE
3. Batch processing raster lokal
"""

from pathlib import Path
from typing import List, Optional

import geopandas as gpd
import pandas as pd
import rasterio
from rasterstats import zonal_stats

from utils.logger import get_logger

log = get_logger("zonal_stats")


def compute_zonal_stats_from_raster(
    gdf: gpd.GeoDataFrame,
    raster_path: str,
    stats: List[str] = ["mean", "std", "min", "max", "count"],
    band: int = 1,
    nodata: Optional[float] = None,
    all_touched: bool = False,
) -> pd.DataFrame:
    """
    Hitung zonal statistics dari raster lokal per polygon blok.

    Args:
        gdf         : GeoDataFrame blok polygon
        raster_path : Path ke file GeoTIFF
        stats       : Statistik yang dihitung
        band        : Nomor band raster (1-indexed)
        nodata      : Override nilai nodata
        all_touched : True = include piksel yang disentuh tepi polygon

    Returns:
        DataFrame dengan block_id dan kolom statistik
    """
    with rasterio.open(raster_path) as src:
        raster_crs = src.crs
        raster_nodata = nodata if nodata is not None else src.nodata

    # Pastikan CRS cocok
    if gdf.crs != raster_crs:
        gdf = gdf.to_crs(raster_crs)

    results = zonal_stats(
        gdf,
        raster_path,
        stats=stats,
        band=band,
        nodata=raster_nodata,
        all_touched=all_touched,
        geojson_out=False,
    )

    df = pd.DataFrame(results)
    df.insert(0, "block_id", gdf["block_id"].values)
    log.info(f"Zonal stats dari {Path(raster_path).name}: {len(df)} blok, stats={stats}")
    return df


def batch_zonal_stats(
    gdf: gpd.GeoDataFrame,
    raster_dir: str,
    pattern: str = "*.tif",
    date_from_filename: bool = True,
) -> pd.DataFrame:
    """
    Batch processing: hitung zonal stats untuk semua raster dalam direktori.

    Berguna untuk CHIRPS yang didownload per hari (satu file per tanggal).

    Args:
        gdf                  : GeoDataFrame blok polygon
        raster_dir           : Direktori berisi file .tif
        pattern              : Glob pattern (default *.tif)
        date_from_filename   : Extract tanggal dari nama file (format YYYY.MM.DD)

    Returns:
        DataFrame long format: block_id, date, mean, std, ...
    """
    raster_files = sorted(Path(raster_dir).glob(pattern))
    if not raster_files:
        log.warning(f"Tidak ada file {pattern} di {raster_dir}")
        return pd.DataFrame()

    all_records = []
    for raster_path in raster_files:
        df = compute_zonal_stats_from_raster(gdf, str(raster_path))

        if date_from_filename:
            # CHIRPS filename: chirps-v2.0.2024.01.15.tif
            stem = raster_path.stem
            parts = stem.split(".")
            if len(parts) >= 4:
                try:
                    date_str = f"{parts[-3]}-{parts[-2]}-{parts[-1]}"
                    df["date"] = date_str
                except Exception:
                    df["date"] = stem

        df["raster_file"] = raster_path.name
        all_records.append(df)

    result = pd.concat(all_records, ignore_index=True)
    log.info(f"Batch zonal stats: {len(raster_files)} raster, {len(result)} records total")
    return result

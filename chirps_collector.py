"""
collectors/chirps_collector.py
==============================
Akuisisi curah hujan harian dari CHIRPS (Climate Hazards center InfraRed
Precipitation with Station data) via HTTP download + rasterio extraction.

TENTANG CHIRPS:
---------------
- Penyedia: Climate Hazards Center, UC Santa Barbara
- URL: https://www.chc.ucsb.edu/data/chirps
- Resolusi: ~5.5 km (0.05 derajat)
- Coverage: 50°S - 50°N, global
- Temporal: 1981 - sekarang, latency ~2-3 minggu
- Format: NetCDF4 (global), GeoTIFF (regional)
- Lisensi: Open access, tidak perlu API key

CARA AKSES:
-----------
Dua cara yang didukung pipeline ini:
1. VIA GEE (direkomendasikan untuk area kecil): UCSB-CHG/CHIRPS/DAILY
2. VIA HTTP DIREKTORI (untuk download massal): data.chc.ucsb.edu/products/CHIRPS-2.0/

Untuk PalmWatch, GEE lebih efisien karena sudah dalam satu pipeline.
HTTP download disediakan sebagai fallback dan untuk pre-caching.

WINDOW AKUMULASI:
----------------
Pipeline menghitung akumulasi 30, 60, dan 90 hari secara otomatis.
Ini penting untuk deteksi defisit air kumulatif pada sawit.
"""

from datetime import datetime, timedelta
from pathlib import Path
from typing import List

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
import rasterio
from rasterio.mask import mask as raster_mask
from shapely.geometry import mapping

from utils.logger import get_logger

log = get_logger("chirps_collector")

CHIRPS_BASE_HTTP = "https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_daily/tifs/p05"
CHIRPS_GEE_COLLECTION = "UCSB-CHG/CHIRPS/DAILY"


# ─────────────────────────────────────────────────────────────────────────────
# METODE 1: VIA GEE (direkomendasikan)
# ─────────────────────────────────────────────────────────────────────────────

def get_chirps_via_gee(
    gdf: gpd.GeoDataFrame,
    start_date: str,
    end_date: str,
    accumulation_windows: List[int] = [30, 60, 90],
) -> pd.DataFrame:
    """
    Ambil curah hujan CHIRPS per blok via Google Earth Engine.
    Termasuk akumulasi 30, 60, 90 hari.

    Args:
        gdf                  : GeoDataFrame blok polygon
        start_date           : Tanggal awal 'YYYY-MM-DD'
        end_date             : Tanggal akhir 'YYYY-MM-DD'
        accumulation_windows : List window akumulasi (hari)

    Returns:
        DataFrame: block_id, date, rainfall_mm, rain_acc_30d, rain_acc_60d, rain_acc_90d
    """
    try:
        import ee
        # _zonal_stats_ee sengaja diimpor untuk memastikan modul GEE lengkap
        # sebelum lanjut (probe ketersediaan), bukan untuk dipakai langsung.
        from gee_collector import init_gee, _zonal_stats_ee  # noqa: F401
        from utils.geometry import gdf_to_ee_featurecollection
    except ImportError:
        log.error("earthengine-api tidak terinstall. Gunakan get_chirps_via_http() sebagai fallback.")
        raise

    init_gee()
    fc = ee.FeatureCollection(gdf_to_ee_featurecollection(gdf))

    # Ambil data dengan buffer sebelum start_date untuk akumulasi maksimum
    max_window = max(accumulation_windows)
    buffer_start = (datetime.strptime(start_date, "%Y-%m-%d") - timedelta(days=max_window)).strftime("%Y-%m-%d")

    collection = (
        ee.ImageCollection(CHIRPS_GEE_COLLECTION)
        .filterDate(buffer_start, end_date)
        .filterBounds(fc)
        .select("precipitation")
    )

    # Hitung zonal stats per hari
    def _reduce_date(img):
        date = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd")
        stats = img.reduceRegions(
            collection=fc,
            reducer=ee.Reducer.mean(),
            scale=5566,
            tileScale=4,
        )
        return stats.map(lambda f: f.set("date", date))

    all_stats = collection.map(_reduce_date).flatten()
    features = all_stats.getInfo()["features"]

    records = []
    for feat in features:
        props = feat["properties"]
        records.append({
            "block_id": props.get("block_id"),
            "date": props.get("date"),
            "rainfall_mm": props.get("mean", props.get("precipitation")),
        })

    df = pd.DataFrame(records)
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["block_id", "date"])

    # Hitung window akumulasi per blok
    for window in accumulation_windows:
        col_name = f"rain_acc_{window}d"
        df[col_name] = (
            df.groupby("block_id")["rainfall_mm"]
            .transform(lambda x: x.rolling(window, min_periods=window // 2).sum())
        )

    # Filter ke tanggal yang diminta (potong buffer)
    df = df[df["date"] >= start_date].copy()
    df["date"] = df["date"].dt.strftime("%Y-%m-%d")

    log.info(f"CHIRPS via GEE: {len(df)} records, {df['block_id'].nunique()} blok")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# METODE 2: VIA HTTP DIREKTORI (fallback)
# ─────────────────────────────────────────────────────────────────────────────

def get_chirps_via_http(
    gdf: gpd.GeoDataFrame,
    start_date: str,
    end_date: str,
    cache_dir: str = "cache/chirps",
) -> pd.DataFrame:
    """
    Download curah hujan CHIRPS dari server HTTP CHC UCSB.
    Gunakan sebagai fallback jika GEE tidak tersedia.

    URL format: https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_daily/tifs/p05/
                {year}/chirps-v2.0.{YYYY}.{MM}.{DD}.tif.gz

    Args:
        gdf        : GeoDataFrame blok polygon
        start_date : 'YYYY-MM-DD'
        end_date   : 'YYYY-MM-DD'
        cache_dir  : Direktori untuk cache GeoTIFF

    Returns:
        DataFrame: block_id, date, rainfall_mm
    """
    Path(cache_dir).mkdir(parents=True, exist_ok=True)

    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    dates = [start + timedelta(days=i) for i in range((end - start).days + 1)]

    geometries = [mapping(geom) for geom in gdf.geometry]
    block_ids = gdf["block_id"].tolist()

    all_records = []

    for date in dates:
        date_str = date.strftime("%Y.%m.%d")
        year_str = date.strftime("%Y")
        filename = f"chirps-v2.0.{date_str}.tif"
        gz_filename = filename + ".gz"
        cache_path = Path(cache_dir) / year_str / filename

        # Download jika belum ada di cache
        if not cache_path.exists():
            url = f"{CHIRPS_BASE_HTTP}/{year_str}/{gz_filename}"
            gz_path = cache_path.with_suffix(".tif.gz")
            cache_path.parent.mkdir(parents=True, exist_ok=True)

            log.info(f"Mendownload CHIRPS: {url}")
            resp = requests.get(url, timeout=60, stream=True)
            if resp.status_code != 200:
                log.warning(f"CHIRPS {date_str} tidak tersedia (HTTP {resp.status_code})")
                continue

            with open(gz_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)

            # Decompress
            import gzip
            import shutil
            with gzip.open(gz_path, "rb") as f_in, open(cache_path, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)
            gz_path.unlink()

        # Ekstrak nilai per polygon menggunakan rasterio
        try:
            with rasterio.open(cache_path) as src:
                for block_id, geom in zip(block_ids, geometries):
                    try:
                        out_image, _ = raster_mask(src, [geom], crop=True, nodata=np.nan)
                        valid = out_image[out_image != src.nodata]
                        value = float(np.nanmean(valid)) if len(valid) > 0 else np.nan
                        all_records.append({
                            "block_id": block_id,
                            "date": date.strftime("%Y-%m-%d"),
                            "rainfall_mm": value if value >= 0 else np.nan,
                        })
                    except Exception:
                        all_records.append({
                            "block_id": block_id,
                            "date": date.strftime("%Y-%m-%d"),
                            "rainfall_mm": np.nan,
                        })
        except Exception as e:
            log.error(f"Gagal membaca {cache_path}: {e}")

    df = pd.DataFrame(all_records)
    log.info(f"CHIRPS via HTTP: {len(df)} records dari {len(dates)} hari")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# ANOMALY CURAH HUJAN
# ─────────────────────────────────────────────────────────────────────────────

def compute_rainfall_anomaly(
    df_current: pd.DataFrame,
    df_baseline: pd.DataFrame,
    window_days: int = 30,
) -> pd.DataFrame:
    """
    Hitung anomaly curah hujan vs baseline historis.
    Anomaly = (current_accumulation - baseline_mean) / baseline_std

    Args:
        df_current  : DataFrame rainfall periode saat ini
        df_baseline : DataFrame rainfall historis (misalnya 5-10 tahun)
        window_days : Window akumulasi untuk perbandingan

    Returns:
        df_current dengan tambahan kolom: rain_anomaly_{window}d (z-score)
    """
    acc_col = f"rain_acc_{window_days}d"
    base_col = f"baseline_mean_{window_days}d"
    std_col = f"baseline_std_{window_days}d"

    if acc_col not in df_current.columns:
        raise ValueError(f"Kolom {acc_col} tidak ada. Jalankan get_chirps dulu.")

    # Hitung statistik baseline per bulan (untuk seasonality)
    df_baseline = df_baseline.copy()
    df_baseline["month"] = pd.to_datetime(df_baseline["date"]).dt.month

    baseline_stats = (
        df_baseline.groupby(["block_id", "month"])[acc_col]
        .agg(["mean", "std"])
        .rename(columns={"mean": base_col, "std": std_col})
        .reset_index()
    )

    df_current = df_current.copy()
    df_current["month"] = pd.to_datetime(df_current["date"]).dt.month
    df_current = df_current.merge(baseline_stats, on=["block_id", "month"], how="left")
    df_current[f"rain_anomaly_{window_days}d"] = (
        (df_current[acc_col] - df_current[base_col]) / (df_current[std_col] + 0.001)
    )
    df_current = df_current.drop(columns=["month", base_col, std_col])

    log.info(f"Rainfall anomaly ({window_days}d) dihitung untuk {df_current['block_id'].nunique()} blok")
    return df_current

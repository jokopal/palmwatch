"""
processors/normalizer.py
=========================
Normalisasi parameter EO per blok per periode untuk persiapan regresi.

DUA METODE NORMALISASI:
-----------------------
1. Min-Max (0-1): untuk visualisasi dan overlay scoring
   formula: (x - min) / (max - min)

2. Z-score: untuk regresi statistik dan anomaly detection
   formula: (x - mean) / std

KAPAN MENGGUNAKAN MASING-MASING:
---------------------------------
- Min-Max  : Overlay index, scoring intervensi, visualisasi heatmap
- Z-score  : Input regresi OLS/GWR, deteksi anomaly, perbandingan lintas variabel

CATATAN PENTING:
----------------
- Normalisasi dilakukan PER VARIABEL secara independen
- Untuk regresi, normalisasi menggunakan SELURUH dataset estate (bukan per blok)
  sehingga nilai relatif antar blok terjaga
- Threshold NDVI (0.45, 0.75) tetap menggunakan skala asli untuk interpretasi agronomis
- Nilai yang dinormalisasi digunakan untuk modeling, bukan untuk laporan ke petani
"""

from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from scipy import stats

from utils.logger import get_logger

log = get_logger("normalizer")


# ─────────────────────────────────────────────────────────────────────────────
# KONFIGURASI VARIABEL
# ─────────────────────────────────────────────────────────────────────────────

# Kolom yang dinormalisasi untuk analisis regresi
DYNAMIC_VARS = [
    "ndvi_mean",
    "evi_mean",
    "lai_mean",
    "fpar_mean",
    "lst_celsius",
    "rainfall_mm",
    "rain_acc_30d",
    "rain_acc_60d",
    "rain_acc_90d",
    "et_mm8d",
    "et_stress_ratio",
    "soil_moisture_m3m3",
    "sar_vv_db",
    "sar_vh_db",
]

STATIC_VARS = [
    "soil_phh2o",
    "soil_soc",
    "soil_clay",
    "soil_sand",
    "soil_cec",
    "elevation_m",
    "slope_deg",
    "twi_approx",
]


# ─────────────────────────────────────────────────────────────────────────────
# MIN-MAX NORMALISASI
# ─────────────────────────────────────────────────────────────────────────────

def minmax_normalize(
    df: pd.DataFrame,
    columns: Optional[List[str]] = None,
    feature_range: Tuple[float, float] = (0.0, 1.0),
    clip: bool = True,
) -> Tuple[pd.DataFrame, Dict[str, Dict]]:
    """
    Normalisasi Min-Max untuk semua kolom numerik yang ditentukan.
    Mengembalikan DataFrame ternormalisasi DAN parameter scaler untuk inverse transform.

    Args:
        df            : DataFrame input
        columns       : Kolom yang dinormalisasi (default: semua float)
        feature_range : Range output (default 0-1)
        clip          : Clip nilai di luar range setelah normalisasi

    Returns:
        (df_normalized, scaler_params)
        scaler_params: {col: {'min': float, 'max': float, 'range': tuple}}
    """
    df_out = df.copy()
    a, b = feature_range

    if columns is None:
        columns = df.select_dtypes(include=[np.number]).columns.tolist()
        columns = [c for c in columns if not c.endswith("_id")]

    scaler_params = {}

    for col in columns:
        if col not in df.columns:
            continue
        series = df[col].dropna()
        if len(series) == 0:
            log.warning(f"Kolom {col} kosong — set normalized ke {a}")
            df_out[f"{col}_norm"] = a
            scaler_params[col] = {"min": 0.0, "max": 0.0, "range": feature_range}
            continue

        col_min = series.min()
        col_max = series.max()
        col_range = col_max - col_min

        if col_range == 0:
            log.warning(f"Kolom {col} {'kosong' if len(series) == 0 else 'konstan'} — set normalized ke {a}")
            df_out[f"{col}_norm"] = a
            scaler_params[col] = {"min": col_min if len(series) > 0 else 0.0, "max": col_max if len(series) > 0 else 0.0, "range": feature_range}
            continue

        normalized = a + (df[col] - col_min) / col_range * (b - a)
        if clip:
            normalized = normalized.clip(a, b)
        df_out[f"{col}_norm"] = normalized

        scaler_params[col] = {
            "min": col_min,
            "max": col_max,
            "range": feature_range,
            "method": "minmax",
        }

    log.info(f"Min-Max normalisasi: {len(scaler_params)} kolom")
    return df_out, scaler_params


def minmax_inverse(
    df: pd.DataFrame,
    scaler_params: Dict[str, Dict],
    suffix: str = "_norm",
) -> pd.DataFrame:
    """Inverse transform Min-Max: kembalikan ke skala asli."""
    df_out = df.copy()
    a, b = list(scaler_params.values())[0].get("range", (0, 1)) if scaler_params else (0, 1)

    for col, params in scaler_params.items():
        norm_col = f"{col}{suffix}"
        if norm_col not in df.columns:
            continue
        col_min = params["min"]
        col_max = params["max"]
        df_out[col] = col_min + (df[norm_col] - a) / (b - a) * (col_max - col_min)

    return df_out


# ─────────────────────────────────────────────────────────────────────────────
# Z-SCORE NORMALISASI
# ─────────────────────────────────────────────────────────────────────────────

def zscore_normalize(
    df: pd.DataFrame,
    columns: Optional[List[str]] = None,
    robust: bool = False,
) -> Tuple[pd.DataFrame, Dict[str, Dict]]:
    """
    Z-score normalisasi (standardisasi) per kolom.
    Digunakan sebagai input untuk regresi OLS dan GWR.

    Args:
        df      : DataFrame input
        columns : Kolom yang dinormalisasi
        robust  : Gunakan median/MAD instead of mean/std (lebih robust terhadap outlier)

    Returns:
        (df_normalized, scaler_params)
        scaler_params: {col: {'mean': float, 'std': float}}
    """
    df_out = df.copy()

    if columns is None:
        columns = df.select_dtypes(include=[np.number]).columns.tolist()
        columns = [c for c in columns if not c.endswith("_id")]

    scaler_params = {}

    for col in columns:
        if col not in df.columns:
            continue
        series = df[col].dropna()
        if len(series) < 3:
            continue

        if robust:
            center = series.median()
            scale = (series - center).abs().median() * 1.4826  # MAD = median absolute deviation, scaled to sigma
            if scale == 0:
                scale = 1.0
        else:
            center = series.mean()
            scale = series.std()
            if scale == 0:
                scale = 1.0

        df_out[f"{col}_z"] = (df[col] - center) / scale
        scaler_params[col] = {
            "center": center,
            "scale": scale,
            "method": "robust_zscore" if robust else "zscore",
            "n": len(series),
        }

    log.info(f"Z-score normalisasi: {len(scaler_params)} kolom ({'robust' if robust else 'standard'})")
    return df_out, scaler_params


# ─────────────────────────────────────────────────────────────────────────────
# NORMALISASI ANOMALY (vs BASELINE HISTORIS)
# ─────────────────────────────────────────────────────────────────────────────

def compute_anomaly_vs_baseline(
    df_current: pd.DataFrame,
    df_baseline: pd.DataFrame,
    variable_col: str,
    date_col: str = "date",
    block_col: str = "block_id",
    seasonal: bool = True,
) -> pd.DataFrame:
    """
    Hitung anomaly suatu variabel terhadap baseline historis.
    Anomaly = (current - baseline_mean) / baseline_std

    Contoh penggunaan: NDVI anomaly (NDVI sekarang vs rata-rata historis bulan yang sama)

    Args:
        df_current  : Data periode monitoring
        df_baseline : Data historis (minimal 3 tahun)
        variable_col: Nama kolom yang dihitung anomalynya
        seasonal    : Hitung per bulan (True) atau global (False)

    Returns:
        df_current dengan tambahan kolom: {variable_col}_anomaly
    """
    df_b = df_baseline.copy()
    df_c = df_current.copy()

    if seasonal:
        df_b["_month"] = pd.to_datetime(df_b[date_col]).dt.month
        df_c["_month"] = pd.to_datetime(df_c[date_col]).dt.month
        group_cols = [block_col, "_month"]
    else:
        group_cols = [block_col]

    baseline_stats = (
        df_b.groupby(group_cols)[variable_col]
        .agg(["mean", "std"])
        .rename(columns={"mean": "_base_mean", "std": "_base_std"})
        .reset_index()
    )

    df_c = df_c.merge(baseline_stats, on=group_cols, how="left")
    df_c[f"{variable_col}_anomaly"] = (
        (df_c[variable_col] - df_c["_base_mean"]) / (df_c["_base_std"] + 1e-6)
    )
    df_c = df_c.drop(columns=[c for c in ["_base_mean", "_base_std", "_month"] if c in df_c.columns])

    log.info(f"Anomaly {variable_col}: dihitung untuk {df_c[block_col].nunique()} blok")
    return df_c


# ─────────────────────────────────────────────────────────────────────────────
# OUTLIER DETECTION DAN CLEANING
# ─────────────────────────────────────────────────────────────────────────────

def flag_outliers(
    df: pd.DataFrame,
    columns: List[str],
    method: str = "iqr",
    threshold: float = 3.0,
) -> pd.DataFrame:
    """
    Tandai outlier pada kolom numerik.
    Outlier TIDAK dihapus — hanya ditandai dengan flag untuk review.

    Args:
        method    : 'iqr' (Interquartile Range) atau 'zscore'
        threshold : Untuk IQR: 1.5x default; untuk zscore: n_std cutoff

    Returns:
        df dengan tambahan kolom: {col}_outlier_flag (bool)
    """
    df_out = df.copy()

    for col in columns:
        if col not in df.columns:
            continue
        series = df[col].dropna()
        flag_col = f"{col}_outlier_flag"

        if method == "iqr":
            q1 = series.quantile(0.25)
            q3 = series.quantile(0.75)
            iqr = q3 - q1
            lower = q1 - threshold * iqr
            upper = q3 + threshold * iqr
            df_out[flag_col] = (df[col] < lower) | (df[col] > upper)
        elif method == "zscore":
            z_scores = np.abs(stats.zscore(series, nan_policy="omit"))
            df_out[flag_col] = False
            df_out.loc[df[col].notna(), flag_col] = z_scores > threshold

        n_outliers = df_out[flag_col].sum()
        if n_outliers > 0:
            log.warning(f"Outlier {col}: {n_outliers} records ({n_outliers/len(df)*100:.1f}%)")

    return df_out


# ─────────────────────────────────────────────────────────────────────────────
# PIPELINE NORMALISASI LENGKAP
# ─────────────────────────────────────────────────────────────────────────────

def normalize_pipeline(
    df: pd.DataFrame,
    dynamic_columns: Optional[List[str]] = None,
    static_columns: Optional[List[str]] = None,
    methods: List[str] = ["minmax", "zscore"],
    flag_outliers_first: bool = True,
) -> Tuple[pd.DataFrame, Dict]:
    """
    Pipeline normalisasi lengkap: flag outlier → min-max → z-score.

    Args:
        df              : DataFrame gabungan (dynamic + static)
        dynamic_columns : Kolom variabel temporal (NDVI, curah hujan, dll.)
        static_columns  : Kolom variabel statis (tanah, topografi)
        methods         : ['minmax', 'zscore'] atau subset
        flag_outliers_first: Tandai outlier sebelum normalisasi

    Returns:
        (df_normalized, metadata)
        metadata: {'minmax_params': {...}, 'zscore_params': {...}, 'n_outliers': {...}}
    """
    df_out = df.copy()
    metadata = {}

    all_cols = []
    if dynamic_columns:
        all_cols.extend([c for c in dynamic_columns if c in df.columns])
    elif DYNAMIC_VARS:
        all_cols.extend([c for c in DYNAMIC_VARS if c in df.columns])

    if static_columns:
        all_cols.extend([c for c in static_columns if c in df.columns])
    else:
        all_cols.extend([c for c in STATIC_VARS if c in df.columns])

    if not all_cols:
        log.warning("Tidak ada kolom yang cocok untuk normalisasi")
        return df_out, metadata

    # Step 1: Flag outlier
    if flag_outliers_first:
        df_out = flag_outliers(df_out, all_cols, method="iqr", threshold=3.0)
        metadata["n_outliers"] = {
            col: df_out.get(f"{col}_outlier_flag", pd.Series([False])).sum()
            for col in all_cols
        }

    # Step 2: Min-Max
    if "minmax" in methods:
        df_out, mm_params = minmax_normalize(df_out, all_cols)
        metadata["minmax_params"] = mm_params

    # Step 3: Z-score
    if "zscore" in methods:
        df_out, z_params = zscore_normalize(df_out, all_cols)
        metadata["zscore_params"] = z_params

    log.info(f"Pipeline normalisasi selesai: {len(all_cols)} variabel, {len(df_out)} records")
    return df_out, metadata

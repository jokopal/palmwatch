"""
processors/overlay.py
======================
Spatial overlay multi-layer per blok polygon untuk klasifikasi kondisi.

LOGIKA OVERLAY:
---------------
Setiap blok menerima "tag kondisi" berdasarkan threshold yang dilanggar.
Overlay dilakukan dengan membandingkan nilai setiap parameter terhadap
threshold dari config/thresholds.yaml, bukan overlay raster fisik.

Contoh output per blok:
  conditions: ["ndvi_low", "rainfall_deficit_30d", "soil_ph_low"]
  → lookup di intervention_triggers → intervensi: irigasi + pengapuran

TIPE OVERLAY:
-------------
1. Threshold-based : Setiap parameter dicheck vs threshold (utama)
2. Spatial vector  : Intersection polygon layer tambahan (misal: peta drainase)
3. Composite score : Weighted sum semua kondisi untuk priority ranking
"""

from typing import Any, Dict, List, Optional, Tuple

import geopandas as gpd
import numpy as np
import pandas as pd
import yaml

from utils.logger import get_logger

log = get_logger("overlay")


def load_thresholds(threshold_path: str = "config/thresholds.yaml") -> Dict:
    """Load threshold config dari YAML."""
    with open(threshold_path, "r") as f:
        return yaml.safe_load(f)


# ─────────────────────────────────────────────────────────────────────────────
# THRESHOLD-BASED CONDITION TAGGING
# ─────────────────────────────────────────────────────────────────────────────

# Definisi kondisi: nama_kondisi → (kolom, operator, threshold_key, threshold_level)
CONDITION_RULES = {
    # NDVI
    "ndvi_critical":   ("ndvi_mean",         "<",  0.35,  "critical"),
    "ndvi_low":        ("ndvi_mean",         "<",  0.45,  "stress"),
    "ndvi_suboptimal": ("ndvi_mean",         "<",  0.55,  "normal_low"),

    # EVI
    "evi_low":         ("evi_mean",          "<",  0.30,  "stress"),

    # LAI
    "lai_low":         ("lai_mean",          "<",  3.0,   "stress"),
    "lai_critical":    ("lai_mean",          "<",  2.0,   "critical"),

    # LST
    "heat_stress":     ("lst_celsius",       ">",  35.0,  "stress"),
    "heat_critical":   ("lst_celsius",       ">",  38.0,  "critical"),

    # Curah hujan
    "rainfall_deficit_30d":   ("rain_acc_30d",      "<",  100.0, "critical"),
    "rainfall_low_30d":       ("rain_acc_30d",      "<",  150.0, "stress"),
    "rainfall_excess_30d":    ("rain_acc_30d",      ">",  400.0, "excess"),
    "rainfall_deficit_90d":   ("rain_acc_90d",      "<",  300.0, "critical"),
    "rainfall_low_90d":       ("rain_acc_90d",      "<",  450.0, "stress"),

    # ET stress
    "et_stress":       ("et_stress_ratio",   "<",  0.70,  "stress"),
    "et_critical":     ("et_stress_ratio",   "<",  0.50,  "critical"),

    # Soil moisture
    "sm_low":          ("soil_moisture_m3m3","<",  0.20,  "stress"),
    "sm_critical":     ("soil_moisture_m3m3","<",  0.15,  "critical"),
    "sm_excess":       ("soil_moisture_m3m3",">",  0.45,  "excess"),

    # Tanah — pH
    "soil_ph_critical":("soil_phh2o",        "<",  4.0,   "critical"),
    "soil_ph_low":     ("soil_phh2o",        "<",  4.5,   "stress"),

    # Tanah — SOC
    "soil_soc_low":    ("soil_soc",          "<",  10.0,  "low"),
    "soil_soc_critical":("soil_soc",         "<",  5.0,   "critical"),

    # Topografi
    "high_slope":      ("slope_deg",         ">",  25.0,  "risk"),
    "high_twi":        ("twi_approx",        ">",  8.0,   "risk"),
}

# Skor severity per level
SEVERITY_SCORES = {
    "critical": 3,
    "stress":   2,
    "excess":   2,
    "low":      1,
    "risk":     1,
    "normal_low": 0.5,
    "suboptimal": 0.5,
}


def tag_conditions(
    df: pd.DataFrame,
    custom_rules: Optional[Dict] = None,
) -> pd.DataFrame:
    """
    Tandai kondisi per blok berdasarkan threshold.
    Output: kolom boolean per kondisi + list kondisi aktif per blok.

    Args:
        df           : DataFrame dengan semua kolom parameter
        custom_rules : Override atau tambah rules (opsional)

    Returns:
        df dengan tambahan kolom:
        - Boolean flag per kondisi: cond_ndvi_low, cond_rainfall_deficit_30d, dll.
        - conditions_list: list kondisi aktif per baris
        - severity_score: skor total severity
        - priority_level: 'critical', 'warning', 'monitor', 'normal'
    """
    rules = {**CONDITION_RULES}
    if custom_rules:
        rules.update(custom_rules)

    df_out = df.copy()

    for cond_name, (col, op, threshold, level) in rules.items():
        flag_col = f"cond_{cond_name}"
        if col not in df.columns:
            df_out[flag_col] = False
            continue

        if op == "<":
            df_out[flag_col] = df[col] < threshold
        elif op == ">":
            df_out[flag_col] = df[col] > threshold
        elif op == "<=":
            df_out[flag_col] = df[col] <= threshold
        elif op == ">=":
            df_out[flag_col] = df[col] >= threshold
        elif op == "==":
            df_out[flag_col] = df[col] == threshold

        # Handle NaN — tidak trigger kondisi
        df_out[flag_col] = df_out[flag_col].fillna(False)

    # Build conditions_list per baris
    cond_cols = [f"cond_{name}" for name in rules.keys() if f"cond_{name}" in df_out.columns]

    def _active_conditions(row):
        return [col.replace("cond_", "") for col in cond_cols if row[col]]

    df_out["conditions_list"] = df_out[cond_cols].apply(_active_conditions, axis=1)
    df_out["n_conditions"] = df_out["conditions_list"].apply(len)

    # Severity score
    def _severity(row):
        score = 0.0
        for cond in row["conditions_list"]:
            level = CONDITION_RULES.get(cond, ("", "", "", ""))[3]
            score += SEVERITY_SCORES.get(level, 0)
        return round(score, 1)

    df_out["severity_score"] = df_out.apply(_severity, axis=1)

    # Priority level
    df_out["priority_level"] = pd.cut(
        df_out["severity_score"],
        bins=[-np.inf, 0, 2, 5, np.inf],
        labels=["normal", "monitor", "warning", "critical"],
    )

    active_blocks = (df_out["n_conditions"] > 0).sum()
    log.info(f"Condition tagging: {active_blocks}/{len(df_out)} blok dengan kondisi aktif")
    return df_out


# ─────────────────────────────────────────────────────────────────────────────
# INTERVENTION LOOKUP
# ─────────────────────────────────────────────────────────────────────────────

INTERVENTION_MATRIX = {
    # (frozenset kondisi wajib) → {intervensi, prioritas, lag_weeks_min, lag_weeks_max, literatur}
    frozenset(["ndvi_low", "rainfall_deficit_30d"]): {
        "intervention": "irrigation_supplement",
        "label": "Irigasi / mulching",
        "priority": 1,
        "lag_weeks_min": 4,
        "lag_weeks_max": 8,
        "literature": "Corley & Tinker, 2003",
    },
    frozenset(["ndvi_low", "soil_soc_low"]): {
        "intervention": "fertilization_n",
        "label": "Pemupukan N (Urea/ZA)",
        "priority": 2,
        "lag_weeks_min": 12,
        "lag_weeks_max": 24,
        "literature": "Goh et al., 1999",
    },
    frozenset(["soil_ph_low"]): {
        "intervention": "liming",
        "label": "Pengapuran dolomit",
        "priority": 2,
        "lag_weeks_min": 12,
        "lag_weeks_max": 16,
        "literature": "Fairhurst & Hardter, 2003",
    },
    frozenset(["soil_ph_critical"]): {
        "intervention": "liming_urgent",
        "label": "Pengapuran segera (pH kritis)",
        "priority": 1,
        "lag_weeks_min": 12,
        "lag_weeks_max": 16,
        "literature": "Fairhurst & Hardter, 2003",
    },
    frozenset(["high_twi", "rainfall_excess_30d"]): {
        "intervention": "drainage_improvement",
        "label": "Perbaikan sistem drainase",
        "priority": 2,
        "lag_weeks_min": 4,
        "lag_weeks_max": 12,
        "literature": "Paramananthan, 2000",
    },
    frozenset(["heat_stress", "et_stress"]): {
        "intervention": "shade_water_management",
        "label": "Manajemen air + naungan",
        "priority": 3,
        "lag_weeks_min": 2,
        "lag_weeks_max": 6,
        "literature": "Corley & Tinker, 2003",
    },
    frozenset(["lai_critical"]): {
        "intervention": "pruning_assessment",
        "label": "Asesmen pemangkasan + nutrisi",
        "priority": 2,
        "lag_weeks_min": 8,
        "lag_weeks_max": 12,
        "literature": "Breure, 2003",
    },
}


def lookup_interventions(df: pd.DataFrame) -> pd.DataFrame:
    """
    Lookup intervensi berdasarkan kondisi aktif per blok.
    Satu blok bisa memiliki multiple intervensi.

    Returns:
        df dengan tambahan kolom: interventions (list of dicts)
    """
    def _match_interventions(conditions: List[str]) -> List[Dict]:
        matched = []
        cond_set = set(conditions)
        for required_conds, intervention in INTERVENTION_MATRIX.items():
            # Match jika semua kondisi yang disyaratkan ada
            if required_conds.issubset(cond_set):
                matched.append(intervention.copy())
        # Sort by priority
        matched.sort(key=lambda x: x.get("priority", 99))
        return matched

    df_out = df.copy()
    df_out["interventions"] = df_out["conditions_list"].apply(_match_interventions)
    df_out["n_interventions"] = df_out["interventions"].apply(len)

    total_with_intervention = (df_out["n_interventions"] > 0).sum()
    log.info(f"Intervention lookup: {total_with_intervention} blok membutuhkan intervensi")
    return df_out


# ─────────────────────────────────────────────────────────────────────────────
# OVERLAY DENGAN LAYER VEKTOR EKSTERNAL
# ─────────────────────────────────────────────────────────────────────────────

def overlay_with_vector_layer(
    blocks_gdf: gpd.GeoDataFrame,
    layer_gdf: gpd.GeoDataFrame,
    layer_name: str,
    attribute_col: Optional[str] = None,
    how: str = "intersection",
) -> gpd.GeoDataFrame:
    """
    Overlay blok polygon dengan layer vektor tambahan.
    Contoh: overlay dengan peta jenis tanah, peta drainase, peta penyakit historis.

    Args:
        blocks_gdf   : GeoDataFrame blok panen
        layer_gdf    : Layer vektor yang di-overlay
        layer_name   : Nama layer untuk prefix kolom output
        attribute_col: Kolom atribut dari layer yang diambil
        how          : Tipe overlay ('intersection', 'union', 'identity')

    Returns:
        GeoDataFrame dengan atribut layer ditambahkan ke setiap blok
    """
    if blocks_gdf.crs != layer_gdf.crs:
        layer_gdf = layer_gdf.to_crs(blocks_gdf.crs)

    if attribute_col:
        layer_gdf = layer_gdf[[attribute_col, "geometry"]].copy()
        layer_gdf = layer_gdf.rename(columns={attribute_col: f"{layer_name}_{attribute_col}"})

    result = gpd.overlay(blocks_gdf, layer_gdf, how=how, keep_geom_type=True)
    log.info(f"Overlay dengan {layer_name}: {len(result)} features")
    return result


# ─────────────────────────────────────────────────────────────────────────────
# COMPOSITE SCORE PER BLOK
# ─────────────────────────────────────────────────────────────────────────────

def compute_composite_score(
    df: pd.DataFrame,
    weights: Optional[Dict[str, float]] = None,
) -> pd.DataFrame:
    """
    Hitung composite intervention score per blok dari semua variabel ternormalisasi.
    Digunakan untuk ranking blok prioritas intervensi.

    Default weights berdasarkan kekuatan korelasi agronomis yang diketahui.

    Args:
        df      : DataFrame dengan kolom _norm (dari normalizer)
        weights : Override weights per variabel (0-1)

    Returns:
        df dengan tambahan kolom: composite_score (0-100), rank
    """
    DEFAULT_WEIGHTS = {
        # Semakin rendah NDVI → semakin tinggi skor masalah (invert)
        "ndvi_mean_norm":        -1.5,   # korelasi kuat dengan TBS
        "evi_mean_norm":         -1.0,
        "lai_mean_norm":         -0.8,
        "rain_acc_90d_norm":     -0.7,   # defisit kumulatif
        "et_stress_ratio_norm":  -0.6,
        "soil_moisture_m3m3_norm": -0.5,
        "soil_phh2o_norm":       -0.4,   # pH rendah = masalah
        "soil_soc_norm":         -0.3,
    }

    w = weights if weights else DEFAULT_WEIGHTS
    available_cols = {col: wt for col, wt in w.items() if col in df.columns}

    if not available_cols:
        log.warning("Tidak ada kolom _norm yang tersedia untuk composite score")
        df["composite_score"] = 0
        return df

    df_out = df.copy()
    score = pd.Series(0.0, index=df_out.index)
    total_weight = sum(abs(v) for v in available_cols.values())

    for col, weight in available_cols.items():
        score += df_out[col].fillna(0.5) * weight

    # Normalisasi ke 0-100 (0 = kondisi terbaik, 100 = kondisi terburuk)
    score_min = score.min()
    score_max = score.max()
    if score_max != score_min:
        df_out["composite_score"] = ((score - score_min) / (score_max - score_min) * 100).round(1)
    else:
        df_out["composite_score"] = 50.0

    df_out["intervention_rank"] = df_out["composite_score"].rank(ascending=False, method="min").astype(int)

    log.info(f"Composite score: median={df_out['composite_score'].median():.1f}, "
             f"top 10%: {(df_out['composite_score'] >= df_out['composite_score'].quantile(0.9)).sum()} blok")
    return df_out

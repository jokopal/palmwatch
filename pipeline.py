"""
pipeline.py
============
Orchestrator utama Fase 1 PalmWatch — menggabungkan semua collector,
processor, dan storage dalam satu eksekusi end-to-end.

ALUR PIPELINE:
--------------
1. Load blok polygon → validasi geometri
2. Akuisisi data EO via GEE (NDVI, EVI, LAI, LST, ET, SAR)
3. Akuisisi curah hujan CHIRPS
4. Akuisisi data tanah SoilGrids (statis, skip jika sudah ada)
5. Akuisisi topografi SRTM (statis, skip jika sudah ada)
6. Gabungkan semua dataset per blok
7. Normalisasi (Min-Max + Z-score)
8. Tag kondisi berdasarkan threshold
9. Lookup intervensi berdasarkan kondisi
10. Hitung composite score dan ranking
11. Simpan ke PostGIS
12. Export GeoJSON hasil untuk dashboard

IDEMPOTENCY:
------------
Pipeline bisa dijalankan ulang dengan parameter yang sama tanpa duplikasi data.
Data lama di-overwrite untuk periode yang sama (UPSERT di PostGIS).
"""

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import geopandas as gpd
import pandas as pd
from dotenv import load_dotenv

from gee_collector import (
    get_ndvi_evi_sentinel2,
    get_ndvi_evi_landsat9,
    get_lai_fpar_modis,
    get_lst_modis,
    get_et_modis,
    get_sar_sentinel1,
    get_terrain_static,
)
from chirps_collector import get_chirps_via_gee
from soilgrids_collector import get_soilgrids_for_blocks
from normalizer import normalize_pipeline, DYNAMIC_VARS, STATIC_VARS
from overlay import tag_conditions, lookup_interventions, compute_composite_score
from postgis_writer import (
    init_schema,
    write_blocks,
    write_eo_readings,
    write_soil_properties,
    write_block_conditions,
)
from utils.geometry import load_blocks
from utils.logger import get_logger

load_dotenv()
log = get_logger("pipeline")


def run_phase1(
    blocks_path: Optional[str] = None,
    tenant_id: str = "demo",
    start_date: str = "",
    end_date: str = "",
    output_dir: str = "results/",
    skip_static: bool = False,
    skip_db_write: bool = False,
    blocks_gdf: Optional["gpd.GeoDataFrame"] = None,
) -> Dict:
    """
    Jalankan pipeline Fase 1 secara lengkap.

    Args:
        blocks_path  : Path ke GeoJSON/Shapefile blok polygon (bila blocks_gdf None)
        tenant_id    : ID perusahaan/project (untuk kolom tenant_id di PostGIS)
        start_date   : 'YYYY-MM-DD' awal periode monitoring
        end_date     : 'YYYY-MM-DD' akhir periode monitoring
        output_dir   : Direktori output GeoJSON dan CSV
        skip_static  : True jika data tanah/topografi sudah ada di DB
        skip_db_write: True untuk dry-run tanpa tulis ke DB
        blocks_gdf   : GeoDataFrame blok siap-pakai (mis. dari Supabase per project).
                       Bila diisi, blocks_path diabaikan.

    Returns:
        Dict summary: {n_blocks, n_eo_records, n_conditions, output_files}
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    summary = {"tenant_id": tenant_id, "start_date": start_date, "end_date": end_date}

    log.info(f"=== PalmWatch Fase 1 Pipeline ===")
    log.info(f"Tenant  : {tenant_id}")
    log.info(f"Periode : {start_date} - {end_date}")
    log.info(f"Blok    : {blocks_path or '(GeoDataFrame)'}")

    # ── STEP 1: Load blok polygon ────────────────────────────────────────────
    log.info("Step 1/10: Load blok polygon")
    if blocks_gdf is not None:
        gdf = blocks_gdf
    elif blocks_path is not None:
        gdf = load_blocks(blocks_path)
    else:
        raise ValueError("Sediakan blocks_path atau blocks_gdf")
    n_blocks = len(gdf)
    summary["n_blocks"] = n_blocks
    log.info(f"  {n_blocks} blok, total {gdf['area_ha'].sum():.0f} ha")

    # ── STEP 2: Inisialisasi DB schema ───────────────────────────────────────
    if not skip_db_write:
        log.info("Step 2/10: Inisialisasi skema PostGIS")
        init_schema(tenant_id)
        write_blocks(gdf, tenant_id)

    # ── STEP 3: NDVI + EVI (Sentinel-2) ─────────────────────────────────────
    log.info("Step 3/10: Akuisisi NDVI/EVI via Sentinel-2")
    df_ndvi = get_ndvi_evi_sentinel2(gdf, start_date, end_date)
    if df_ndvi.empty:
        log.warning("  Sentinel-2 tidak ada data. Fallback ke Landsat-9.")
        df_ndvi = get_ndvi_evi_landsat9(gdf, start_date, end_date)
    log.info(f"  {len(df_ndvi)} records NDVI/EVI")

    # ── STEP 4: LAI + FPAR (MODIS) ──────────────────────────────────────────
    log.info("Step 4/10: Akuisisi LAI/FPAR via MODIS")
    df_lai = get_lai_fpar_modis(gdf, start_date, end_date)
    log.info(f"  {len(df_lai)} records LAI/FPAR")

    # ── STEP 5: LST + ET (MODIS) ─────────────────────────────────────────────
    log.info("Step 5/10: Akuisisi LST dan ET via MODIS")
    df_lst = get_lst_modis(gdf, start_date, end_date)
    df_et = get_et_modis(gdf, start_date, end_date)
    log.info(f"  {len(df_lst)} records LST, {len(df_et)} records ET")

    # ── STEP 6: Curah Hujan CHIRPS ───────────────────────────────────────────
    log.info("Step 6/10: Akuisisi curah hujan CHIRPS")
    df_rain = get_chirps_via_gee(gdf, start_date, end_date, accumulation_windows=[30, 60, 90])
    log.info(f"  {len(df_rain)} records curah hujan")

    # ── STEP 7: Data Statis (SoilGrids + Terrain) ───────────────────────────
    if not skip_static:
        log.info("Step 7/10: Akuisisi data tanah (SoilGrids) dan topografi (SRTM)")
        df_soil = get_soilgrids_for_blocks(gdf)
        df_terrain = get_terrain_static(gdf)
        log.info(f"  {len(df_soil)} blok tanah, {len(df_terrain)} blok topografi")

        if not skip_db_write:
            write_soil_properties(df_soil, tenant_id)
    else:
        log.info("Step 7/10: Skip static data (sudah ada di DB)")
        df_soil = pd.DataFrame()
        df_terrain = pd.DataFrame()

    # ── STEP 8: Gabungkan semua dataset ─────────────────────────────────────
    log.info("Step 8/10: Menggabungkan semua dataset")
    df_combined = _merge_all_datasets(df_ndvi, df_lai, df_lst, df_et, df_rain, df_soil, df_terrain)
    summary["n_eo_records"] = len(df_combined)
    log.info(f"  Dataset gabungan: {len(df_combined)} records, {df_combined.columns.tolist()[:8]}...")

    # ── STEP 8b: SAR sebagai backup jika NDVI banyak null ───────────────────
    ndvi_null_pct = df_combined["ndvi_mean"].isna().mean() if "ndvi_mean" in df_combined.columns else 1.0
    if ndvi_null_pct > 0.5:
        log.warning(f"  NDVI null {ndvi_null_pct*100:.0f}% — akuisisi SAR Sentinel-1 sebagai backup")
        df_sar = get_sar_sentinel1(gdf, start_date, end_date)
        df_combined = df_combined.merge(df_sar[["block_id","sar_vv_db","sar_vh_db"]], on="block_id", how="left")

    # ── STEP 9: Normalisasi ──────────────────────────────────────────────────
    log.info("Step 9/10: Normalisasi Min-Max + Z-score")
    df_normalized, norm_metadata = normalize_pipeline(
        df_combined,
        methods=["minmax", "zscore"],
        flag_outliers_first=True,
    )
    n_outliers_total = sum(norm_metadata.get("n_outliers", {}).values())
    log.info(f"  Normalisasi selesai. Total outlier terflag: {n_outliers_total}")

    # ── STEP 10: Tag kondisi + intervensi + scoring ──────────────────────────
    log.info("Step 10/10: Overlay kondisi, intervensi, dan composite scoring")
    # Ambil snapshot per blok (nilai terbaru untuk kondisi)
    df_latest = _get_latest_per_block(df_normalized, date_col="date" if "date" in df_normalized.columns else "period_start")
    df_conditions = tag_conditions(df_latest)
    df_interventions = lookup_interventions(df_conditions)
    df_scored = compute_composite_score(df_interventions)

    n_critical = (df_scored["priority_level"] == "critical").sum()
    n_warning = (df_scored["priority_level"] == "warning").sum()
    summary["n_critical_blocks"] = int(n_critical)
    summary["n_warning_blocks"] = int(n_warning)
    log.info(f"  Critical: {n_critical} blok | Warning: {n_warning} blok")

    # ── WRITE TO DB ──────────────────────────────────────────────────────────
    if not skip_db_write:
        write_eo_readings(df_normalized, tenant_id)
        df_scored["period_start"] = start_date
        df_scored["period_end"] = end_date
        write_block_conditions(df_scored, tenant_id)

    # ── EXPORT OUTPUT ─────────────────────────────────────────────────────────
    output_files = _export_results(gdf, df_scored, df_normalized, output_dir, start_date, end_date)
    summary["output_files"] = output_files

    log.info(f"=== Pipeline selesai ===")
    log.info(f"Output: {output_files}")
    return summary


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _merge_all_datasets(
    df_ndvi: pd.DataFrame,
    df_lai: pd.DataFrame,
    df_lst: pd.DataFrame,
    df_et: pd.DataFrame,
    df_rain: pd.DataFrame,
    df_soil: pd.DataFrame,
    df_terrain: pd.DataFrame,
) -> pd.DataFrame:
    """Gabungkan semua dataset per blok (join pada block_id dan date/period)."""
    # Tentukan kolom date yang digunakan tiap dataset
    # NDVI menggunakan period_start, yang lain menggunakan date
    merged = df_ndvi.copy() if not df_ndvi.empty else pd.DataFrame()

    if merged.empty:
        return pd.DataFrame()

    date_col = "period_start" if "period_start" in merged.columns else "date"

    # Agregasi LAI, LST, ET per periode NDVI (16-hari)
    for df_right, right_cols in [
        (df_lai, ["block_id", "lai_mean", "fpar_mean"]),
        (df_lst, ["block_id", "lst_celsius"]),
        (df_et,  ["block_id", "et_mm8d", "et_stress_ratio"]),
    ]:
        if df_right.empty:
            continue
        # Agregasi ke periode 16-hari: mean nilai
        available_cols = [c for c in right_cols if c in df_right.columns]
        df_agg = df_right[available_cols].groupby("block_id").mean().reset_index()
        merged = merged.merge(df_agg, on="block_id", how="left")

    # CHIRPS: gunakan nilai akumulasi terbaru per blok
    if not df_rain.empty:
        rain_cols = ["block_id", "rainfall_mm", "rain_acc_30d", "rain_acc_60d", "rain_acc_90d"]
        available = [c for c in rain_cols if c in df_rain.columns]
        df_rain_latest = df_rain.sort_values("date").groupby("block_id").last().reset_index()[available]
        merged = merged.merge(df_rain_latest, on="block_id", how="left")

    # Data statis (join sekali saja)
    for df_static, cols in [(df_soil, None), (df_terrain, None)]:
        if df_static.empty or "block_id" not in df_static.columns:
            continue
        merged = merged.merge(df_static, on="block_id", how="left", suffixes=("", "_static"))

    return merged


def _get_latest_per_block(df: pd.DataFrame, date_col: str = "period_start") -> pd.DataFrame:
    """Ambil record terbaru per blok untuk snapshot kondisi."""
    if date_col in df.columns:
        return df.sort_values(date_col).groupby("block_id").last().reset_index()
    return df.groupby("block_id").last().reset_index()


def _export_results(
    gdf: gpd.GeoDataFrame,
    df_conditions: pd.DataFrame,
    df_eo: pd.DataFrame,
    output_dir: str,
    start_date: str,
    end_date: str,
) -> Dict[str, str]:
    """Export hasil pipeline ke GeoJSON dan CSV."""
    ts = datetime.now().strftime("%Y%m%d_%H%M")
    period = f"{start_date}_{end_date}".replace("-", "")
    files = {}

    # GeoJSON untuk dashboard (blok + kondisi + intervensi)
    if not df_conditions.empty and "block_id" in df_conditions.columns:
        gdf_out = gdf[["block_id", "geometry"]].merge(df_conditions, on="block_id", how="left")

        # Serialisasi kolom list/dict
        for col in ["conditions_list", "interventions"]:
            if col in gdf_out.columns:
                gdf_out[col] = gdf_out[col].apply(
                    lambda x: json.dumps(x) if isinstance(x, (list, dict)) else x
                )

        geojson_path = f"{output_dir}/conditions_{period}_{ts}.geojson"
        gdf_out.to_file(geojson_path, driver="GeoJSON")
        files["geojson_conditions"] = geojson_path

    # CSV EO readings (untuk analisis regresi Fase 2)
    if not df_eo.empty:
        csv_path = f"{output_dir}/eo_readings_{period}_{ts}.csv"
        df_eo.to_csv(csv_path, index=False)
        files["csv_eo_readings"] = csv_path

    return files

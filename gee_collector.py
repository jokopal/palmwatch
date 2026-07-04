"""
collectors/gee_collector.py
===========================
Akuisisi data EO dari Google Earth Engine untuk PalmWatch.

CARA AUTENTIKASI:
-----------------
1. Daftar Google Earth Engine: https://earthengine.google.com/
2. Buat Service Account di GCP:
   - Console GCP > IAM & Admin > Service Accounts
   - Buat SA, download JSON key
   - Daftarkan SA di: https://code.earthengine.google.com/register
3. Set env vars: GEE_SERVICE_ACCOUNT dan GEE_KEY_FILE

ATAU (untuk development lokal):
   $ earthengine authenticate
   (browser OAuth — hanya untuk personal use, bukan production)

PARAMETER YANG DIAKUISISI:
--------------------------
- NDVI + EVI    : Sentinel-2 SR (10m) + Landsat-9 fallback (30m)
- EVI MODIS     : MOD13A2 (1km, 16-hari)
- LAI + FPAR    : MCD15A3H (500m, 4-hari)
- LST           : MOD11A1 (1km, harian)
- ET            : MOD16A2 (500m, 8-hari)
- Soil Moisture : SPL4SMGP SMAP (9km, 3-jam)
- SAR VV/VH     : Sentinel-1 GRD (10m, 6-12 hari)
- DEM/Slope/TWI : SRTM (30m, statis)
"""

import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import ee
import numpy as np
import pandas as pd
import geopandas as gpd

from utils.logger import get_logger
from utils.geometry import gdf_to_ee_featurecollection, bbox_from_gdf

log = get_logger("gee_collector")


def init_gee() -> None:
    """
    Inisialisasi GEE. Prioritaskan service account (production),
    fallback ke credentials lokal (development).
    """
    sa = os.getenv("GEE_SERVICE_ACCOUNT")
    key_file = os.getenv("GEE_KEY_FILE")
    project = os.getenv("GEE_PROJECT")

    if sa and key_file and os.path.exists(key_file):
        credentials = ee.ServiceAccountCredentials(sa, key_file)
        ee.Initialize(credentials, project=project)
        log.info(f"GEE inisialisasi via service account: {sa}")
    else:
        ee.Initialize(project=project)
        log.info("GEE inisialisasi via credentials lokal (~/.config/earthengine/)")


# ─────────────────────────────────────────────────────────────────────────────
# HELPER FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

def _mask_s2_clouds(image: ee.Image) -> ee.Image:
    """Mask awan Sentinel-2 menggunakan band SCL (Scene Classification Layer)."""
    scl = image.select("SCL")
    # SCL values: 4=vegetation, 5=bare soil, 6=water, 11=snow
    # Exclude: 1=saturated, 3=cloud shadow, 7=unclassified, 8=cloud medium, 9=cloud high, 10=cirrus
    cloud_mask = scl.neq(3).And(scl.neq(7)).And(scl.neq(8)).And(scl.neq(9)).And(scl.neq(10))
    return image.updateMask(cloud_mask).divide(10000)  # scale ke 0-1


def _mask_landsat_clouds(image: ee.Image) -> ee.Image:
    """Mask awan Landsat-9 C2 menggunakan QA_PIXEL band."""
    qa = image.select("QA_PIXEL")
    cloud_bit = 1 << 3
    shadow_bit = 1 << 4
    mask = qa.bitwiseAnd(cloud_bit).eq(0).And(qa.bitwiseAnd(shadow_bit).eq(0))
    return image.updateMask(mask).multiply(0.0000275).add(-0.2)  # scale SR


def _zonal_stats_ee(
    image: ee.Image,
    blocks_fc: ee.FeatureCollection,
    band_name: str,
    reducer: str = "mean",
    scale: int = 30,
) -> List[Dict]:
    """
    Hitung zonal statistics (mean/median/std) per blok polygon di GEE server.
    Mengembalikan list of dicts: [{block_id, value, date}]

    Args:
        image      : ee.Image yang akan direduksi
        blocks_fc  : ee.FeatureCollection polygon blok
        band_name  : Nama band untuk output
        reducer    : 'mean', 'median', 'stdDev'
        scale      : resolusi dalam meter
    """
    ee_reducer = {
        "mean": ee.Reducer.mean(),
        "median": ee.Reducer.median(),
        "stdDev": ee.Reducer.stdDev(),
        "min": ee.Reducer.min(),
        "max": ee.Reducer.max(),
    }.get(reducer, ee.Reducer.mean())

    result = image.reduceRegions(
        collection=blocks_fc,
        reducer=ee_reducer,
        scale=scale,
        tileScale=4,  # membantu untuk area besar
    )

    features = result.getInfo()["features"]
    records = []
    for feat in features:
        props = feat.get("properties", {})
        records.append({
            "block_id": props.get("block_id"),
            "area_ha": props.get("area_ha"),
            band_name: props.get(reducer, props.get("mean")),
        })
    return records


# ─────────────────────────────────────────────────────────────────────────────
# SENTINEL-2 NDVI + EVI
# ─────────────────────────────────────────────────────────────────────────────

def get_ndvi_evi_sentinel2(
    gdf: gpd.GeoDataFrame,
    start_date: str,
    end_date: str,
    cloud_pct_max: int = 30,
    composite_days: int = 16,
) -> pd.DataFrame:
    """
    Ambil NDVI dan EVI dari Sentinel-2 SR per blok per periode komposit.

    SUMBER: COPERNICUS/S2_SR_HARMONIZED
    RESOLUSI: 10m
    FREKUENSI: komposit median 16-hari

    Args:
        gdf           : GeoDataFrame blok polygon (EPSG:4326)
        start_date    : 'YYYY-MM-DD'
        end_date      : 'YYYY-MM-DD'
        cloud_pct_max : Threshold cloud cover per scene (%)
        composite_days: Ukuran window komposit median

    Returns:
        DataFrame kolom: block_id, period_start, ndvi_mean, evi_mean,
                         ndvi_std, cloud_coverage_pct
    """
    init_gee()
    fc = ee.FeatureCollection(gdf_to_ee_featurecollection(gdf))

    # Buat list periode komposit
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    periods = []
    cur = start
    while cur < end:
        periods.append((cur, cur + timedelta(days=composite_days)))
        cur += timedelta(days=composite_days)

    all_records = []

    for period_start, period_end in periods:
        ps = period_start.strftime("%Y-%m-%d")
        pe = period_end.strftime("%Y-%m-%d")

        collection = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterDate(ps, pe)
            .filterBounds(fc)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud_pct_max))
            .map(_mask_s2_clouds)
        )

        count = collection.size().getInfo()
        if count == 0:
            log.warning(f"Tidak ada scene Sentinel-2 di {ps} - {pe}, skip (cloud >30%?)")
            continue

        # Komposit median — lebih robust dari mean untuk outlier awan residual
        composite = collection.median()

        # Kalkulasi indeks vegetasi
        ndvi = composite.normalizedDifference(["B8", "B4"]).rename("ndvi")
        evi = composite.expression(
            "2.5 * ((NIR - RED) / (NIR + 6*RED - 7.5*BLUE + 1))",
            {"NIR": composite.select("B8"), "RED": composite.select("B4"), "BLUE": composite.select("B2")},
        ).rename("evi")

        # Zonal stats per blok
        records_ndvi = _zonal_stats_ee(ndvi, fc, "ndvi_mean", "mean", scale=10)
        records_ndvi_std = _zonal_stats_ee(ndvi, fc, "ndvi_std", "stdDev", scale=10)
        records_evi = _zonal_stats_ee(evi, fc, "evi_mean", "mean", scale=10)

        # Gabungkan
        df_ndvi = pd.DataFrame(records_ndvi)
        df_std = pd.DataFrame(records_ndvi_std)[["block_id", "ndvi_std"]]
        df_evi = pd.DataFrame(records_evi)[["block_id", "evi_mean"]]

        df = df_ndvi.merge(df_std, on="block_id").merge(df_evi, on="block_id")
        df["period_start"] = ps
        df["period_end"] = pe
        df["source"] = "Sentinel-2"
        df["n_scenes"] = count

        all_records.append(df)
        log.info(f"NDVI/EVI selesai: {ps} - {pe} ({count} scenes, {len(df)} blok)")

    if not all_records:
        log.warning("Tidak ada data NDVI/EVI — semua periode tertutup awan. Coba fallback ke Landsat.")
        return pd.DataFrame()

    return pd.concat(all_records, ignore_index=True)


def get_ndvi_evi_landsat9(
    gdf: gpd.GeoDataFrame,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    Fallback NDVI/EVI dari Landsat-9 jika Sentinel-2 tidak tersedia.

    SUMBER: LANDSAT/LC09/C02/T1_L2
    RESOLUSI: 30m
    """
    init_gee()
    fc = ee.FeatureCollection(gdf_to_ee_featurecollection(gdf))

    collection = (
        ee.ImageCollection("LANDSAT/LC09/C02/T1_L2")
        .filterDate(start_date, end_date)
        .filterBounds(fc)
        .map(_mask_landsat_clouds)
    )

    composite = collection.median()
    ndvi = composite.normalizedDifference(["SR_B5", "SR_B4"]).rename("ndvi")
    evi = composite.expression(
        "2.5 * ((NIR - RED) / (NIR + 6*RED - 7.5*BLUE + 1))",
        {"NIR": composite.select("SR_B5"), "RED": composite.select("SR_B4"), "BLUE": composite.select("SR_B2")},
    ).rename("evi")

    records_ndvi = _zonal_stats_ee(ndvi, fc, "ndvi_mean", "mean", scale=30)
    records_evi = _zonal_stats_ee(evi, fc, "evi_mean", "mean", scale=30)

    df = pd.DataFrame(records_ndvi).merge(pd.DataFrame(records_evi)[["block_id", "evi_mean"]], on="block_id")
    df["period_start"] = start_date
    df["source"] = "Landsat-9"
    log.info(f"NDVI/EVI Landsat-9: {len(df)} blok")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# LAI + FPAR (MODIS MCD15A3H)
# ─────────────────────────────────────────────────────────────────────────────

def get_lai_fpar_modis(
    gdf: gpd.GeoDataFrame,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    Ambil LAI dan FPAR dari MODIS MCD15A3H per blok.

    SUMBER: MODIS/061/MCD15A3H
    RESOLUSI: 500m
    FREKUENSI: 4 hari
    SCALE FACTOR: LAI * 0.1, FPAR * 0.01
    """
    init_gee()
    fc = ee.FeatureCollection(gdf_to_ee_featurecollection(gdf))

    collection = (
        ee.ImageCollection("MODIS/061/MCD15A3H")
        .filterDate(start_date, end_date)
        .filterBounds(fc)
        .select(["Lai_500m", "Fpar_500m"])
        .map(lambda img: img
             .multiply(ee.Image([0.1, 0.01]))  # scale factors
             .copyProperties(img, img.propertyNames()))
    )

    def _reduce_period(img):
        date = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd")
        stats = img.reduceRegions(collection=fc, reducer=ee.Reducer.mean(), scale=500, tileScale=4)
        return stats.map(lambda f: f.set("date", date))

    # Flatten semua tanggal menjadi satu FeatureCollection
    all_stats = collection.map(_reduce_period).flatten()
    features = all_stats.getInfo()["features"]

    records = []
    for feat in features:
        props = feat["properties"]
        records.append({
            "block_id": props.get("block_id"),
            "date": props.get("date"),
            "lai_mean": props.get("Lai_500m"),
            "fpar_mean": props.get("Fpar_500m"),
        })

    df = pd.DataFrame(records)
    log.info(f"LAI/FPAR MODIS: {len(df)} records dari {df['date'].nunique()} tanggal")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# LAND SURFACE TEMPERATURE (MODIS MOD11A1)
# ─────────────────────────────────────────────────────────────────────────────

def get_lst_modis(
    gdf: gpd.GeoDataFrame,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    Ambil Land Surface Temperature dari MODIS MOD11A1.

    SUMBER: MODIS/061/MOD11A1
    RESOLUSI: 1km
    FREKUENSI: Harian
    KONVERSI: Kelvin * 0.02 - 273.15 = Celsius
    """
    init_gee()
    fc = ee.FeatureCollection(gdf_to_ee_featurecollection(gdf))

    def _to_celsius(img):
        lst_c = img.select("LST_Day_1km").multiply(0.02).subtract(273.15).rename("lst_celsius")
        return lst_c.copyProperties(img, ["system:time_start"])

    collection = (
        ee.ImageCollection("MODIS/061/MOD11A1")
        .filterDate(start_date, end_date)
        .filterBounds(fc)
        .map(_to_celsius)
    )

    def _reduce_date(img):
        date = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd")
        stats = img.reduceRegions(collection=fc, reducer=ee.Reducer.mean(), scale=1000, tileScale=4)
        return stats.map(lambda f: f.set("date", date))

    all_stats = collection.map(_reduce_date).flatten()
    features = all_stats.getInfo()["features"]

    records = []
    for feat in features:
        props = feat["properties"]
        records.append({
            "block_id": props.get("block_id"),
            "date": props.get("date"),
            "lst_celsius": props.get("lst_celsius"),
        })

    df = pd.DataFrame(records)
    log.info(f"LST MODIS: {len(df)} records")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# EVAPOTRANSPIRASI (MODIS MOD16A2)
# ─────────────────────────────────────────────────────────────────────────────

def get_et_modis(
    gdf: gpd.GeoDataFrame,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    Ambil Evapotranspirasi aktual dari MODIS MOD16A2.

    SUMBER: MODIS/061/MOD16A2
    RESOLUSI: 500m
    FREKUENSI: 8 hari (kumulatif dalam window)
    SCALE FACTOR: ET * 0.1 = kg/m2 per 8 hari (~mm)
    """
    init_gee()
    fc = ee.FeatureCollection(gdf_to_ee_featurecollection(gdf))

    def _scale_et(img):
        et = img.select("ET").multiply(0.1).rename("et_mm8d")
        pet = img.select("PET").multiply(0.1).rename("pet_mm8d")
        # Hitung ET stress ratio: ET_actual / PET
        stress = et.divide(pet.add(0.001)).rename("et_stress_ratio")
        return et.addBands(pet).addBands(stress).copyProperties(img, ["system:time_start"])

    collection = (
        ee.ImageCollection("MODIS/061/MOD16A2")
        .filterDate(start_date, end_date)
        .filterBounds(fc)
        .map(_scale_et)
    )

    def _reduce_date(img):
        date = ee.Date(img.get("system:time_start")).format("YYYY-MM-dd")
        stats = img.reduceRegions(collection=fc, reducer=ee.Reducer.mean(), scale=500, tileScale=4)
        return stats.map(lambda f: f.set("date", date))

    all_stats = collection.map(_reduce_date).flatten()
    features = all_stats.getInfo()["features"]

    records = []
    for feat in features:
        props = feat["properties"]
        records.append({
            "block_id": props.get("block_id"),
            "date": props.get("date"),
            "et_mm8d": props.get("et_mm8d"),
            "pet_mm8d": props.get("pet_mm8d"),
            "et_stress_ratio": props.get("et_stress_ratio"),
        })

    df = pd.DataFrame(records)
    log.info(f"ET MODIS: {len(df)} records")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# SOIL MOISTURE (SMAP via GEE)
# ─────────────────────────────────────────────────────────────────────────────

def get_soil_moisture_smap(
    gdf: gpd.GeoDataFrame,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    Ambil soil moisture permukaan dari SMAP L4 via GEE.

    SUMBER: NASA/SMAP/SPL4SMGP/007
    RESOLUSI: ~9km
    FREKUENSI: 3 jam (diambil komposit harian)
    NOTE: Perlu approval GEE untuk collection NASA SMAP
          Alternatif: NASA GESDISC direct download
    """
    init_gee()
    fc = ee.FeatureCollection(gdf_to_ee_featurecollection(gdf))

    collection = (
        ee.ImageCollection("NASA/SMAP/SPL4SMGP/007")
        .filterDate(start_date, end_date)
        .filterBounds(fc)
        .select("sm_surface")
    )

    # Komposit harian (ambil mean dari 8 gambar per hari)
    def _daily_composite(date_str):
        d = ee.Date(date_str)
        daily = collection.filterDate(d, d.advance(1, "day")).mean()
        stats = daily.reduceRegions(collection=fc, reducer=ee.Reducer.mean(), scale=9000)
        return stats.map(lambda f: f.set("date", date_str))

    # Generate tanggal unik
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    dates = [(start + timedelta(days=i)).strftime("%Y-%m-%d")
             for i in range((end - start).days)]

    records = []
    for date_str in dates:
        try:
            day_col = (
                collection
                .filterDate(date_str, (datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d"))
                .mean()
            )
            stats = day_col.reduceRegions(collection=fc, reducer=ee.Reducer.mean(), scale=9000, tileScale=4)
            for feat in stats.getInfo()["features"]:
                props = feat["properties"]
                records.append({
                    "block_id": props.get("block_id"),
                    "date": date_str,
                    "soil_moisture_m3m3": props.get("mean", props.get("sm_surface")),
                })
        except Exception as e:
            log.warning(f"SMAP {date_str}: {e}")

    df = pd.DataFrame(records)
    log.info(f"Soil Moisture SMAP: {len(df)} records")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# SAR SENTINEL-1 (BACKUP CLOUD COVER)
# ─────────────────────────────────────────────────────────────────────────────

def get_sar_sentinel1(
    gdf: gpd.GeoDataFrame,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """
    Ambil SAR backscatter Sentinel-1 (VV, VH) per blok.
    Digunakan saat optical data tidak tersedia karena awan lebat.

    SUMBER: COPERNICUS/S1_GRD
    RESOLUSI: 10m
    FREKUENSI: 6-12 hari
    ORBIT: ASCENDING dan DESCENDING dipisah
    """
    init_gee()
    fc = ee.FeatureCollection(gdf_to_ee_featurecollection(gdf))

    def _to_linear(img):
        """Konversi dari dB ke linear power untuk averaging."""
        return img.select(["VV", "VH"]).pow(10.0).divide(10.0)

    collection = (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterDate(start_date, end_date)
        .filterBounds(fc)
        .filter(ee.Filter.eq("instrumentMode", "IW"))  # Interferometric Wide Swath
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
    )

    # Komposit median dalam dB (tidak konversi ke linear untuk median)
    composite = collection.select(["VV", "VH"]).median()

    records_vv = _zonal_stats_ee(composite.select("VV"), fc, "sar_vv_db", "mean", scale=10)
    records_vh = _zonal_stats_ee(composite.select("VH"), fc, "sar_vh_db", "mean", scale=10)

    df = pd.DataFrame(records_vv).merge(pd.DataFrame(records_vh)[["block_id", "sar_vh_db"]], on="block_id")
    # Hitung VH/VV ratio (proxy biomassa)
    df["sar_vhvv_ratio"] = df["sar_vh_db"] - df["sar_vv_db"]  # subtraksi dB = rasio linear
    df["period_start"] = start_date
    df["period_end"] = end_date

    log.info(f"SAR Sentinel-1: {len(df)} blok")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# DEM, SLOPE, TWI (SRTM — STATIS)
# ─────────────────────────────────────────────────────────────────────────────

def get_terrain_static(gdf: gpd.GeoDataFrame) -> pd.DataFrame:
    """
    Ambil parameter topografi statis dari SRTM 30m.
    Cukup dijalankan SEKALI per estate (data statis).

    SUMBER: USGS/SRTMGL1_003
    RESOLUSI: 30m
    DERIVATIF: slope (ee.Terrain), aspect, TWI (dihitung manual)

    Returns:
        DataFrame kolom: block_id, elevation_m, slope_deg, aspect_deg, twi_approx
    """
    init_gee()
    fc = ee.FeatureCollection(gdf_to_ee_featurecollection(gdf))

    dem = ee.Image("USGS/SRTMGL1_003")
    terrain = ee.Terrain.products(dem)

    elevation = terrain.select("elevation")
    slope = terrain.select("slope")
    aspect = terrain.select("aspect")

    # TWI approx via GEE: gunakan slope sebagai proxy
    # TWI lebih akurat dari flow accumulation — untuk full TWI butuh SAGA GIS
    # Aproximasi: TWI = ln(1 / tan(slope_rad + 0.001))
    slope_rad = slope.multiply(3.14159265 / 180)
    twi_approx = (slope_rad.add(0.001)).tan().pow(-1).log().rename("twi_approx")

    stacked = elevation.addBands(slope).addBands(aspect).addBands(twi_approx)

    records_elev = _zonal_stats_ee(stacked.select("elevation"), fc, "elevation_m", "mean", scale=30)
    records_slope = _zonal_stats_ee(stacked.select("slope"), fc, "slope_deg", "mean", scale=30)
    records_aspect = _zonal_stats_ee(stacked.select("aspect"), fc, "aspect_deg", "mean", scale=30)
    records_twi = _zonal_stats_ee(stacked.select("twi_approx"), fc, "twi_approx", "mean", scale=30)

    df = (pd.DataFrame(records_elev)
          .merge(pd.DataFrame(records_slope)[["block_id","slope_deg"]], on="block_id")
          .merge(pd.DataFrame(records_aspect)[["block_id","aspect_deg"]], on="block_id")
          .merge(pd.DataFrame(records_twi)[["block_id","twi_approx"]], on="block_id"))

    log.info(f"Terrain SRTM (statis): {len(df)} blok")
    return df

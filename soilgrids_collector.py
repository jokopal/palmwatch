"""
collectors/soilgrids_collector.py
===================================
Akuisisi parameter tanah statis dari ISRIC SoilGrids v2.0 via REST API.

TENTANG SOILGRIDS:
------------------
- Penyedia: ISRIC World Soil Information
- URL: https://soilgrids.org / https://rest.isric.org
- API Docs: https://rest.isric.org/soilgrids/v2.0/docs
- Resolusi: 250m global
- Format response: JSON (nilai per titik) atau WCS (raster)
- Lisensi: CC-BY 4.0 — tidak perlu API key, open access

PARAMETER YANG DIAMBIL:
-----------------------
- phh2o    : pH tanah (dalam air) — scale /10
- soc      : Soil Organic Carbon — scale /10 → g/kg
- clay     : Fraksi lempung — scale /10 → g/kg
- sand     : Fraksi pasir — scale /10 → g/kg
- silt     : Fraksi debu — scale /10 → g/kg
- cec      : Cation Exchange Capacity — scale /10 → mmol(c)/kg
- bdod     : Bulk Density — scale /100 → kg/dm³
- nitrogen : Total Nitrogen — scale /100 → cg/kg

METODE:
-------
Karena SoilGrids REST API bekerja per titik (point query),
pipeline mengambil nilai di centroid setiap blok polygon.
Untuk blok besar (>500ha), pertimbangkan sampling grid 250m dan average.

KEDALAMAN YANG DIAMBIL:
-----------------------
Untuk analisis sawit, kedalaman 0-30cm paling relevan (zona akar aktif).
Pipeline mengambil: 0-5cm, 5-15cm, 15-30cm dan menghitung rata-rata tertimbang.
"""

import time
from typing import Dict, List, Optional

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
from retry import retry

from utils.logger import get_logger

log = get_logger("soilgrids_collector")

SOILGRIDS_API = "https://rest.isric.org/soilgrids/v2.0/properties/query"

# Parameter, scale factor, dan deskripsi
SOIL_PROPERTIES = {
    "phh2o":    {"scale": 0.1,  "unit": "pH",       "label": "pH (H2O)"},
    "soc":      {"scale": 0.1,  "unit": "g/kg",     "label": "Soil Organic Carbon"},
    "clay":     {"scale": 0.1,  "unit": "g/kg",     "label": "Clay fraction"},
    "sand":     {"scale": 0.1,  "unit": "g/kg",     "label": "Sand fraction"},
    "silt":     {"scale": 0.1,  "unit": "g/kg",     "label": "Silt fraction"},
    "cec":      {"scale": 0.1,  "unit": "mmol/kg",  "label": "Cation Exchange Capacity"},
    "bdod":     {"scale": 0.01, "unit": "kg/dm3",   "label": "Bulk Density"},
    "nitrogen": {"scale": 0.01, "unit": "cg/kg",    "label": "Total Nitrogen"},
}

# Kedalaman yang diambil dan bobot tertimbang untuk 0-30cm
DEPTHS = ["0-5cm", "5-15cm", "15-30cm"]
DEPTH_WEIGHTS = {"0-5cm": 5, "5-15cm": 10, "15-30cm": 15}  # proporsi ketebalan


@retry(tries=3, delay=2, backoff=2)
def _query_soilgrids_point(lon: float, lat: float, properties: List[str]) -> Dict:
    """
    Query SoilGrids REST API untuk satu titik koordinat.

    API format:
    GET https://rest.isric.org/soilgrids/v2.0/properties/query
        ?lon={lon}&lat={lat}&property={prop1}&property={prop2}&depth={depth}&value=mean

    Returns:
        Dict dengan struktur: {property: {depth: value, ...}, ...}
    """
    params = {"lon": lon, "lat": lat, "value": "mean"}
    for prop in properties:
        params.setdefault("property", [])
        if isinstance(params["property"], str):
            params["property"] = [params["property"]]
        params["property"].append(prop)
    for depth in DEPTHS:
        params.setdefault("depth", [])
        if isinstance(params["depth"], str):
            params["depth"] = [params["depth"]]
        params["depth"].append(depth)

    # requests tidak mendukung list params langsung — build manual
    query_parts = [f"lon={lon}", f"lat={lat}", "value=mean"]
    for prop in properties:
        query_parts.append(f"property={prop}")
    for depth in DEPTHS:
        query_parts.append(f"depth={depth}")
    url = f"{SOILGRIDS_API}?" + "&".join(query_parts)

    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _parse_soilgrids_response(response: Dict) -> Dict[str, float]:
    """
    Parse response JSON SoilGrids menjadi dict flat dengan nilai rata-rata tertimbang
    untuk kedalaman 0-30cm.

    SoilGrids response structure:
    {
      "properties": {
        "layers": [
          {"name": "phh2o", "depths": [{"label": "0-5cm", "values": {"mean": 47}}, ...]}
        ]
      }
    }
    """
    result = {}
    layers = response.get("properties", {}).get("layers", [])

    for layer in layers:
        prop_name = layer["name"]
        scale = SOIL_PROPERTIES.get(prop_name, {}).get("scale", 1.0)

        # Hitung rata-rata tertimbang berdasarkan ketebalan lapisan
        weighted_sum = 0.0
        total_weight = 0
        for depth_info in layer.get("depths", []):
            depth_label = depth_info["label"]
            if depth_label in DEPTH_WEIGHTS:
                val = depth_info.get("values", {}).get("mean")
                if val is not None:
                    weight = DEPTH_WEIGHTS[depth_label]
                    weighted_sum += val * weight
                    total_weight += weight

        if total_weight > 0:
            result[f"soil_{prop_name}"] = round((weighted_sum / total_weight) * scale, 3)
        else:
            result[f"soil_{prop_name}"] = None

    return result


def get_soilgrids_for_blocks(
    gdf: gpd.GeoDataFrame,
    properties: Optional[List[str]] = None,
    use_grid_sampling: bool = False,
    grid_spacing_m: int = 250,
    rate_limit_delay: float = 0.5,
) -> pd.DataFrame:
    """
    Ambil parameter tanah SoilGrids untuk semua blok polygon.
    Data statis — cukup dijalankan sekali per estate.

    STRATEGI SAMPLING:
    - Default: centroid blok (cepat, cocok untuk blok <200ha)
    - Grid sampling: multiple titik per blok (lebih akurat untuk blok besar)

    Args:
        gdf               : GeoDataFrame blok polygon (EPSG:4326)
        properties        : List property yang diambil (default: semua)
        use_grid_sampling : True untuk sampling grid 250m per blok besar
        grid_spacing_m    : Jarak grid sampling dalam meter
        rate_limit_delay  : Delay antara request (detik) untuk menghindari rate limit

    Returns:
        DataFrame kolom: block_id, soil_phh2o, soil_soc, soil_clay, soil_sand,
                         soil_silt, soil_cec, soil_bdod, soil_nitrogen
    """
    if properties is None:
        properties = list(SOIL_PROPERTIES.keys())

    # Hitung centroid dalam WGS84
    if gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    gdf = gdf.copy()
    gdf["centroid_lon"] = gdf.geometry.centroid.x
    gdf["centroid_lat"] = gdf.geometry.centroid.y

    all_records = []
    total = len(gdf)

    for idx, row in gdf.iterrows():
        block_id = row["block_id"]
        lon = row["centroid_lon"]
        lat = row["centroid_lat"]

        # Validasi koordinat (area tropis Indonesia/Malaysia)
        if not (-15 < lat < 15 and 90 < lon < 140):
            log.warning(f"Koordinat {block_id} ({lat:.3f}, {lon:.3f}) di luar coverage tropis — skip")
            continue

        try:
            response = _query_soilgrids_point(lon, lat, properties)
            soil_values = _parse_soilgrids_response(response)
            soil_values["block_id"] = block_id
            soil_values["centroid_lon"] = lon
            soil_values["centroid_lat"] = lat
            all_records.append(soil_values)

            log.info(f"SoilGrids [{idx+1}/{total}] {block_id}: pH={soil_values.get('soil_phh2o')}, "
                     f"SOC={soil_values.get('soil_soc')}")

        except Exception as e:
            log.error(f"SoilGrids gagal untuk {block_id}: {e}")
            all_records.append({"block_id": block_id})

        # Rate limiting — API public, jangan spam
        time.sleep(rate_limit_delay)

    df = pd.DataFrame(all_records)

    # Tambah derived columns
    if "soil_clay" in df.columns and "soil_sand" in df.columns:
        # Klasifikasi tekstur tanah sederhana
        df["soil_texture_class"] = df.apply(_classify_texture, axis=1)

    log.info(f"SoilGrids selesai: {len(df)} blok dengan {len(properties)} properti")
    return df


def _classify_texture(row: pd.Series) -> str:
    """
    Klasifikasi tekstur tanah berdasarkan clay dan sand fraction.
    Penyederhanaan dari segitiga tekstur USDA.
    """
    clay = row.get("soil_clay", 0) or 0   # g/kg → persen
    sand = row.get("soil_sand", 0) or 0

    # SoilGrids unit g/kg — konversi ke persen
    clay_pct = clay / 10
    sand_pct = sand / 10

    if clay_pct >= 40:
        return "clay"
    elif clay_pct >= 27 and sand_pct < 20:
        return "clay_loam"
    elif clay_pct >= 20 and sand_pct >= 45:
        return "sandy_clay_loam"
    elif sand_pct >= 70:
        return "sandy"
    elif clay_pct < 20 and sand_pct < 50:
        return "loam"
    else:
        return "sandy_loam"


def get_soilgrids_wcs_raster(
    bbox: tuple,
    property_name: str,
    depth: str = "0-5cm",
    output_path: str = "cache/soilgrids/",
) -> str:
    """
    Download SoilGrids sebagai raster GeoTIFF via WCS (Web Coverage Service).
    Gunakan untuk area besar — lebih efisien dari point query.

    WCS URL format:
    https://maps.isric.org/mapserv?map=/map/{property}.map
    &SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage
    &COVERAGEID={property}_{depth}_mean
    &SUBSETTINGCRS=EPSG:4326
    &SUBSET=X({minx},{maxx})&SUBSET=Y({miny},{maxy})
    &OUTPUTCRS=EPSG:4326&FORMAT=image/tiff

    Args:
        bbox         : (minx, miny, maxx, maxy) dalam derajat WGS84
        property_name: misalnya 'phh2o', 'soc', 'clay'
        depth        : '0-5cm', '5-15cm', '15-30cm', dll.
        output_path  : Direktori penyimpanan

    Returns:
        Path file GeoTIFF yang didownload
    """
    import os
    from pathlib import Path

    minx, miny, maxx, maxy = bbox
    depth_clean = depth.replace("-", "").replace("cm", "cm")
    coverage_id = f"{property_name}_{depth_clean}_mean"

    wcs_url = (
        f"https://maps.isric.org/mapserv?map=/map/{property_name}.map"
        f"&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage"
        f"&COVERAGEID={coverage_id}"
        f"&SUBSETTINGCRS=EPSG:4326"
        f"&SUBSET=X({minx},{maxx})"
        f"&SUBSET=Y({miny},{maxy})"
        f"&OUTPUTCRS=EPSG:4326&FORMAT=image/tiff"
    )

    Path(output_path).mkdir(parents=True, exist_ok=True)
    out_file = Path(output_path) / f"{property_name}_{depth_clean}.tif"

    log.info(f"Mendownload SoilGrids WCS: {property_name} {depth}")
    resp = requests.get(wcs_url, timeout=120, stream=True)
    resp.raise_for_status()

    with open(out_file, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)

    log.info(f"SoilGrids WCS tersimpan: {out_file} ({out_file.stat().st_size / 1024:.1f} KB)")
    return str(out_file)

"""
utils/supabase_blocks.py
========================
Jembatan Supabase → pipeline GEE.

Membaca poligon batas blok milik sebuah project dari Supabase (`public.blocks`)
menjadi GeoDataFrame. GeoDataFrame ini yang dipakai collector GEE untuk me-*mask*
/ zonal-stats aset katalog global (Sentinel-2, MODIS, CHIRPS, dll.) tepat pada
batas tiap blok project.
"""

from __future__ import annotations

import json

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape

from postgis_writer import get_engine
from utils.logger import get_logger

log = get_logger("supabase_blocks")


def load_project_blocks(project_id: str, engine=None) -> gpd.GeoDataFrame:
    """
    Muat blok (batas) milik satu project dari Supabase menjadi GeoDataFrame.

    Args:
        project_id : UUID project.
        engine     : SQLAlchemy engine opsional (default dari env SUPABASE_DB_URL).

    Returns:
        GeoDataFrame kolom: block_id, estate, area_ha, planting_year, variety,
        geometry (EPSG:4326).
    """
    eng = engine or get_engine()
    sql = """
        SELECT block_id, estate, area_ha, planting_year, variety,
               ST_AsGeoJSON(geom) AS geojson
        FROM public.blocks
        WHERE project_id = %(pid)s
        ORDER BY block_id
    """
    df = pd.read_sql(sql, eng, params={"pid": project_id})
    if df.empty:
        log.warning("no_blocks_for_project", project_id=project_id)
        return gpd.GeoDataFrame(
            columns=["block_id", "estate", "area_ha", "planting_year", "variety", "geometry"],
            geometry="geometry", crs="EPSG:4326",
        )

    geoms = [shape(json.loads(g)) for g in df["geojson"]]
    gdf = gpd.GeoDataFrame(df.drop(columns=["geojson"]), geometry=geoms, crs="EPSG:4326")
    log.info("project_blocks_loaded", project_id=project_id, n_blocks=len(gdf))
    return gdf

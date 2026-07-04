"""
postgis_writer.py
=================
Tulis hasil pipeline PalmWatch ke Postgres/PostGIS (Supabase).

SUMBER KEBENARAN SKEMA = migrasi Supabase (`supabase/migrations/*_init_schema.sql`).
Modul ini TIDAK lagi membuat tabel; DDL dimiliki oleh migrasi. Semua tulis
menargetkan skema `public` dengan isolasi tenant via kolom `tenant_id`
(bukan skema `tenant_{id}` terpisah — itu inkonsisten dengan dashboard/RPC).

Idempotency: setiap write memakai UPSERT (INSERT ... ON CONFLICT DO UPDATE)
sehingga pipeline dapat dijalankan ulang untuk periode yang sama tanpa duplikasi.

Koneksi: env `SUPABASE_DB_URL` (URI, direkomendasikan) atau `POSTGIS_*`.
"""

from __future__ import annotations

import os
from typing import Optional

import geopandas as gpd
import pandas as pd
from geoalchemy2 import Geometry
from geoalchemy2.shape import from_shape
from sqlalchemy import (
    BigInteger,
    Column,
    Date,
    Float,
    Integer,
    MetaData,
    Table,
    Text,
    create_engine,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import insert as pg_insert

from utils.logger import get_logger

log = get_logger("postgis_writer")

SCHEMA = "public"

# ── Definisi tabel (harus cocok dengan migrasi Supabase) ─────────────────────
_metadata = MetaData()

blocks_t = Table(
    "blocks", _metadata,
    Column("block_id", Text, primary_key=True),
    Column("tenant_id", Text),
    Column("estate", Text),
    Column("area_ha", Float),
    Column("planting_year", Integer),
    Column("variety", Text),
    Column("geom", Geometry("POLYGON", srid=4326)),
    schema=SCHEMA,
)

eo_readings_t = Table(
    "eo_readings", _metadata,
    Column("block_id", Text),
    Column("obs_date", Date),
    Column("source", Text),
    Column("ndvi_mean", Float),
    Column("evi_mean", Float),
    Column("lai_mean", Float),
    Column("fpar_mean", Float),
    Column("lst_celsius", Float),
    Column("rainfall_30d_mm", Float),
    Column("rainfall_90d_mm", Float),
    Column("et_stress_ratio", Float),
    Column("soil_moisture", Float),
    Column("tbs_ton_ha", Float),
    schema=SCHEMA,
)

soil_properties_t = Table(
    "soil_properties", _metadata,
    Column("block_id", Text, primary_key=True),
    Column("soil_ph", Float),
    Column("soil_soc", Float),
    Column("soil_clay", Float),
    Column("soil_sand", Float),
    Column("soil_cec", Float),
    Column("soil_nitrogen", Float),
    schema=SCHEMA,
)

block_conditions_t = Table(
    "block_conditions", _metadata,
    Column("id", BigInteger),
    Column("block_id", Text),
    Column("period_start", Date),
    Column("period_end", Date),
    Column("conditions", JSONB),
    Column("n_conditions", Integer),
    Column("severity_score", Float),
    Column("priority_level", Text),
    Column("interventions", JSONB),
    Column("n_interventions", Integer),
    Column("yield_baseline_ton_ha", Float),
    Column("yield_predicted_after_intervention", Float),
    Column("regression_r2", Float),
    Column("composite_score", Float),
    Column("intervention_rank", Integer),
    schema=SCHEMA,
)

# ── Alias nama kolom pipeline -> nama kolom skema ────────────────────────────
COLUMN_ALIASES: dict[str, dict[str, str]] = {
    "eo_readings": {
        "date": "obs_date",
        "period_start": "obs_date",  # NDVI komposit memakai period_start sbagai tanggal observasi
        "rain_acc_30d": "rainfall_30d_mm",
        "rain_acc_90d": "rainfall_90d_mm",
        "soil_moisture_m3m3": "soil_moisture",
    },
    "soil_properties": {
        "soil_phh2o": "soil_ph",
    },
    "block_conditions": {
        "conditions_list": "conditions",
    },
    "blocks": {
        "geometry": "geom",
    },
}

_TABLES: dict[str, Table] = {
    "blocks": blocks_t,
    "eo_readings": eo_readings_t,
    "soil_properties": soil_properties_t,
    "block_conditions": block_conditions_t,
}

# Kolom kunci konflik untuk UPSERT (harus punya UNIQUE/PK di migrasi).
_CONFLICT_KEYS: dict[str, list[str]] = {
    "blocks": ["block_id"],
    "eo_readings": ["block_id", "obs_date", "source"],
    "soil_properties": ["block_id"],
    "block_conditions": ["block_id", "period_start"],
}


def get_engine():
    """Engine SQLAlchemy dari SUPABASE_DB_URL (URI) atau POSTGIS_* terpisah."""
    url = os.getenv("SUPABASE_DB_URL")
    if url:
        # Normalisasi ke driver psycopg2.
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
        elif url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg2://", 1)
    else:
        host = os.getenv("POSTGIS_HOST", "localhost")
        port = os.getenv("POSTGIS_PORT", "5432")
        db = os.getenv("POSTGIS_DB", "postgres")
        user = os.getenv("POSTGIS_USER", "postgres")
        password = os.getenv("POSTGIS_PASSWORD", "")
        url = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db}"
    return create_engine(url, pool_pre_ping=True)


# ── Transformasi murni (dapat diuji tanpa DB) ────────────────────────────────

def _prepare_frame(
    df: pd.DataFrame,
    table: str,
    tenant_id: Optional[str] = None,
) -> pd.DataFrame:
    """
    Selaraskan DataFrame pipeline ke bentuk kolom tabel target:
    rename alias -> filter kolom valid -> suntik tenant_id.

    Tidak menyentuh DB; deterministik dan dapat diuji.
    """
    if df is None or df.empty:
        return pd.DataFrame()

    out = df.rename(columns=COLUMN_ALIASES.get(table, {})).copy()
    # Bila alias memetakan dua kolom ke nama sama (mis. date & period_start
    # -> obs_date), pertahankan kolom pertama agar tidak duplikat.
    out = out.loc[:, ~out.columns.duplicated()]

    if tenant_id is not None and "tenant_id" in _TABLES[table].columns:
        out["tenant_id"] = tenant_id

    valid = {c.name for c in _TABLES[table].columns} - {"id"}
    keep = [c for c in out.columns if c in valid]
    return out[keep]


def _upsert(engine, table: str, rows: list[dict]) -> int:
    """Jalankan INSERT ... ON CONFLICT DO UPDATE untuk sekumpulan baris."""
    if not rows:
        return 0
    tbl = _TABLES[table]
    conflict = _CONFLICT_KEYS[table]
    present = set(rows[0].keys())
    update_cols = {
        c.name: None
        for c in tbl.columns
        if c.name in present and c.name not in conflict and c.name != "id"
    }
    stmt = pg_insert(tbl).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=conflict,
        set_={name: stmt.excluded[name] for name in update_cols},
    )
    with engine.begin() as conn:
        conn.execute(stmt)
    return len(rows)


# ── API publik (dipakai pipeline.py) ─────────────────────────────────────────

def init_schema(tenant_id: str) -> None:
    """
    No-op: DDL dimiliki oleh migrasi Supabase. Dipertahankan agar pipeline lama
    tetap kompatibel. Onboarding tenant = INSERT baris dengan tenant_id, bukan
    membuat skema baru.
    """
    log.info("init_schema_noop", tenant_id=tenant_id,
             note="DDL dikelola migrasi Supabase (public schema)")


def write_blocks(gdf: gpd.GeoDataFrame, tenant_id: str) -> int:
    """UPSERT master blok polygon ke public.blocks."""
    prepared = _prepare_frame(pd.DataFrame(gdf), "blocks", tenant_id)
    if prepared.empty:
        return 0
    # Geometri: shapely -> WKBElement (SRID 4326).
    geom_series = gdf.geometry
    rows = []
    for idx, row in prepared.iterrows():
        d = row.to_dict()
        d["geom"] = from_shape(geom_series.loc[idx], srid=4326)
        rows.append(d)
    n = _upsert(get_engine(), "blocks", rows)
    log.info("write_blocks", n=n, tenant_id=tenant_id)
    return n


def write_eo_readings(df: pd.DataFrame, tenant_id: str) -> int:
    """UPSERT EO readings ke public.eo_readings (idempoten per block/date/source)."""
    prepared = _prepare_frame(df, "eo_readings", tenant_id)
    if prepared.empty:
        return 0
    if "obs_date" in prepared.columns:
        prepared["obs_date"] = pd.to_datetime(prepared["obs_date"]).dt.date
    if "source" not in prepared.columns:
        prepared["source"] = "composite"
    n = _upsert(get_engine(), "eo_readings", prepared.to_dict("records"))
    log.info("write_eo_readings", n=n, tenant_id=tenant_id)
    return n


def write_soil_properties(df: pd.DataFrame, tenant_id: str) -> int:
    """UPSERT data tanah statis ke public.soil_properties."""
    prepared = _prepare_frame(df, "soil_properties", tenant_id)
    if prepared.empty:
        return 0
    n = _upsert(get_engine(), "soil_properties", prepared.to_dict("records"))
    log.info("write_soil_properties", n=n, tenant_id=tenant_id)
    return n


def write_block_conditions(df: pd.DataFrame, tenant_id: str) -> int:
    """UPSERT kondisi+intervensi ke public.block_conditions (idempoten per periode)."""
    prepared = _prepare_frame(df, "block_conditions", tenant_id)
    if prepared.empty:
        return 0
    for col in ("period_start", "period_end"):
        if col in prepared.columns:
            prepared[col] = pd.to_datetime(prepared[col]).dt.date
    n = _upsert(get_engine(), "block_conditions", prepared.to_dict("records"))
    log.info("write_block_conditions", n=n, tenant_id=tenant_id)
    return n

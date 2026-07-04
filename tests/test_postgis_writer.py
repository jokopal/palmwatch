"""
Tests untuk postgis_writer — lapisan transformasi (pure) + kompilasi UPSERT.

Tidak butuh database: memverifikasi pemetaan kolom pipeline -> skema Supabase
`public`, injeksi tenant_id, dan bahwa statement UPSERT ter-compile untuk
dialek PostgreSQL (termasuk tabel geometri & JSONB).
"""

from __future__ import annotations

import pandas as pd
from shapely.geometry import Polygon
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import insert as pg_insert
from geoalchemy2.shape import from_shape

import postgis_writer as w


def _compile(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect()))


# ── Pemetaan kolom ───────────────────────────────────────────────────────────

def test_eo_alias_mapping_and_filtering():
    df = pd.DataFrame([{
        "block_id": "BLK-001", "date": "2026-06-01", "source": "composite",
        "ndvi_mean": 0.5, "rain_acc_30d": 120, "rain_acc_90d": 300,
        "soil_moisture_m3m3": 0.3, "sar_vv_db": -8.0, "irrelevant": 1,
    }])
    p = w._prepare_frame(df, "eo_readings", "demo")
    cols = set(p.columns)
    assert {"obs_date", "rainfall_30d_mm", "rainfall_90d_mm", "soil_moisture"} <= cols
    # kolom yang tak ada di skema dibuang
    assert "sar_vv_db" not in cols and "irrelevant" not in cols
    # eo_readings tak punya tenant_id -> tidak disuntik
    assert "tenant_id" not in cols


def test_soil_ph_alias():
    df = pd.DataFrame([{"block_id": "BLK-001", "soil_phh2o": 4.9, "soil_soc": 12.0}])
    p = w._prepare_frame(df, "soil_properties", "demo")
    assert "soil_ph" in p.columns and "soil_phh2o" not in p.columns
    assert p["soil_ph"].iloc[0] == 4.9


def test_conditions_alias_and_jsonb_preserved():
    df = pd.DataFrame([{
        "block_id": "BLK-001", "period_start": "2026-06-01",
        "conditions_list": ["ndvi_low", "rainfall_deficit_30d"],
        "interventions": [{"type": "irrigation", "priority": 1}],
        "priority_level": "critical",
    }])
    p = w._prepare_frame(df, "block_conditions", "demo")
    assert "conditions" in p.columns and "conditions_list" not in p.columns
    # struktur list/dict dipertahankan (JSONB di-handle SQLAlchemy)
    assert p["conditions"].iloc[0] == ["ndvi_low", "rainfall_deficit_30d"]
    assert p["interventions"].iloc[0][0]["type"] == "irrigation"


def test_tenant_id_injected_only_for_blocks():
    df = pd.DataFrame([{"block_id": "BLK-001", "area_ha": 42.5}])
    p = w._prepare_frame(df, "blocks", "pt_sawit_maju")
    assert p["tenant_id"].iloc[0] == "pt_sawit_maju"


def test_empty_frame_returns_empty():
    assert w._prepare_frame(pd.DataFrame(), "eo_readings", "demo").empty
    assert w._prepare_frame(None, "blocks", "demo").empty


# ── Kompilasi UPSERT (tanpa DB) ──────────────────────────────────────────────

def test_upsert_compiles_eo():
    df = pd.DataFrame([{
        "block_id": "BLK-001", "obs_date": "2026-06-01", "source": "composite",
        "ndvi_mean": 0.5,
    }])
    rows = df.to_dict("records")
    stmt = pg_insert(w.eo_readings_t).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=w._CONFLICT_KEYS["eo_readings"],
        set_={"ndvi_mean": stmt.excluded["ndvi_mean"]},
    )
    sql = _compile(stmt)
    assert "ON CONFLICT" in sql and "eo_readings" in sql


def test_upsert_compiles_blocks_with_geometry():
    poly = Polygon([(117.1, -0.5), (117.2, -0.5), (117.2, -0.4), (117.1, -0.4)])
    rows = [{
        "block_id": "BLK-001", "tenant_id": "demo", "area_ha": 42.5,
        "geom": from_shape(poly, srid=4326),
    }]
    stmt = pg_insert(w.blocks_t).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["block_id"],
        set_={"area_ha": stmt.excluded["area_ha"]},
    )
    sql = _compile(stmt)
    assert "ON CONFLICT" in sql and "blocks" in sql


def test_upsert_empty_rows_returns_zero():
    assert w._upsert(engine=None, table="eo_readings", rows=[]) == 0

"""
api/data_source.py
==================
Lapisan abstraksi data untuk API dashboard.

Strategi: coba baca dari PostGIS (skema tenant, lihat storage/postgis_writer.py).
Bila DB tidak tersedia / kosong, fallback otomatis ke data sample deterministik
(api/sample_data.py) sehingga dashboard tetap jalan untuk demo Fase 1.

Status sumber data dapat dicek lewat `health()`.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Dict, Optional

from . import sample_data


def _postgis_available() -> bool:
    """True bila variabel koneksi diset DAN driver bisa konek."""
    if not os.getenv("POSTGIS_PASSWORD") and not os.getenv("POSTGIS_HOST_FORCE"):
        return False
    try:
        from sqlalchemy import create_engine, text  # noqa
        host = os.getenv("POSTGIS_HOST", "localhost")
        port = os.getenv("POSTGIS_PORT", "5432")
        db = os.getenv("POSTGIS_DB", "palmwatch")
        user = os.getenv("POSTGIS_USER", "palmwatch_user")
        pw = os.getenv("POSTGIS_PASSWORD", "")
        engine = create_engine(
            f"postgresql+psycopg2://{user}:{pw}@{host}:{port}/{db}",
            pool_pre_ping=True,
            connect_args={"connect_timeout": 3},
        )
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


# ── Cache data sample (deterministik, murah dibangun) ────────────────────────
@lru_cache(maxsize=1)
def _sample_fc() -> str:
    return json.dumps(sample_data.build_feature_collection())


def _fetch_postgis_fc() -> Optional[Dict]:
    if not _postgis_available():
        return None
    try:
        from sqlalchemy import create_engine, text
        host = os.getenv("POSTGIS_HOST", "localhost")
        port = os.getenv("POSTGIS_PORT", "5432")
        db = os.getenv("POSTGIS_DB", "palmwatch")
        user = os.getenv("POSTGIS_USER", "palmwatch_user")
        pw = os.getenv("POSTGIS_PASSWORD", "")
        db_url = (
            os.getenv("SUPABASE_DB_URL")
            or f"postgresql+psycopg2://{user}:{pw}@{host}:{port}/{db}"
        )
        engine = create_engine(
            db_url, pool_pre_ping=True, connect_args={"connect_timeout": 3}
        )

        query = text("""
            SELECT 
                bc.block_id,
                bc.period_start,
                bc.period_end,
                bc.conditions,
                bc.n_conditions,
                bc.severity_score,
                bc.priority_level,
                bc.interventions,
                bc.n_interventions,
                bc.yield_baseline_ton_ha,
                bc.yield_predicted_after_intervention,
                bc.regression_r2,
                bc.composite_score,
                bc.intervention_rank,
                b.area_ha,
                b.estate,
                b.planting_year,
                b.variety,
                ST_AsGeoJSON(b.geom) as geojson
            FROM public.block_conditions bc
            LEFT JOIN public.blocks b ON b.block_id = bc.block_id
            WHERE bc.period_start = (SELECT MAX(period_start) FROM public.block_conditions)
            ORDER BY bc.intervention_rank ASC NULLS LAST
        """)
        with engine.connect() as conn:
            result = conn.execute(query)
            rows = result.fetchall()
            if not rows:
                return None

            features = []
            for row in rows:
                m = row._mapping
                geom = json.loads(m["geojson"]) if m.get("geojson") else None
                conds = m["conditions"]
                if isinstance(conds, str):
                    conds = json.loads(conds)
                interv = m["interventions"]
                if isinstance(interv, str):
                    interv = json.loads(interv)

                sev = m.get("severity_score")
                yb = m.get("yield_baseline_ton_ha")
                yp = m.get("yield_predicted_after_intervention")
                r2 = m.get("regression_r2")
                cs = m.get("composite_score")

                props = {
                    "block_id": m["block_id"],
                    "area_ha": float(m["area_ha"]) if m.get("area_ha") is not None else 0.0,
                    "estate": m.get("estate"),
                    "planting_year": m.get("planting_year"),
                    "last_updated": str(m["period_start"]) if m.get("period_start") else None,
                    "conditions": conds or [],
                    "n_conditions": m.get("n_conditions") or 0,
                    "severity_score": float(sev) if sev is not None else 0.0,
                    "priority_level": m.get("priority_level") or "normal",
                    "interventions": interv or [],
                    "n_interventions": m.get("n_interventions") or 0,
                    "yield_baseline_ton_ha": float(yb) if yb is not None else 0.0,
                    "yield_predicted_after_intervention": float(yp) if yp is not None else 0.0,
                    "regression_r2": float(r2) if r2 is not None else 0.0,
                    "composite_score": float(cs) if cs is not None else 0.0,
                    "intervention_rank": m.get("intervention_rank"),
                }
                features.append({
                    "type": "Feature",
                    "geometry": geom,
                    "properties": props,
                })
            return {
                "type": "FeatureCollection",
                "features": features,
            }
    except Exception:
        return None


def _fc() -> Dict:
    pg_fc = _fetch_postgis_fc()
    if pg_fc is not None:
        return pg_fc
    return json.loads(_sample_fc())


# ── API publik dipakai oleh main.py ──────────────────────────────────────────

def source_name() -> str:
    pg_fc = _fetch_postgis_fc()
    if pg_fc is not None:
        return "postgis"
    return "sample"


def health() -> Dict:
    return {
        "status": "ok",
        "data_source": source_name(),
        "postgis_configured": bool(os.getenv("POSTGIS_PASSWORD")),
        "postgis_reachable": _postgis_available(),
    }


def get_blocks(priority: Optional[str] = None) -> Dict:
    """FeatureCollection semua blok, opsional filter priority_level."""
    fc = _fc()
    if priority:
        fc["features"] = [
            f for f in fc["features"]
            if f["properties"]["priority_level"] == priority
        ]
    return fc


def get_block(block_id: str) -> Optional[Dict]:
    for f in _fc()["features"]:
        if f["properties"]["block_id"] == block_id:
            return f
    return None


def get_timeseries(block_id: str) -> Optional[Dict]:
    if get_block(block_id) is None:
        return None
    return sample_data.build_timeseries(block_id)


def get_summary() -> Dict:
    summary = sample_data.build_summary(_fc())
    summary["data_source"] = source_name()
    return summary

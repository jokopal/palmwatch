"""
api/data_source.py
==================
Lapisan abstraksi data untuk API dashboard.

Satu-satunya sumber data: PostGIS (skema tenant, lihat storage/postgis_writer.py).

TIDAK ADA fallback ke data sample. Dulu endpoint diam-diam menyajikan blok
sintetis saat database tak terjangkau, sehingga dashboard tampak sehat padahal
angkanya karangan — tidak mungkin membedakan "kebun ini memang begitu" dari
"koneksi database putus". Kini ketiadaan data dilaporkan apa adanya sebagai
DataUnavailable, dan pemanggil menerjemahkannya jadi HTTP 503.

Status sumber data dapat dicek lewat `health()`.
"""

from __future__ import annotations

import json
import os
from typing import Dict, Optional


class DataUnavailable(RuntimeError):
    """PostGIS tidak terjangkau. Sengaja tidak diganti data karangan."""


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
    if pg_fc is None:
        raise DataUnavailable(
            "PostGIS tidak terjangkau. Setel POSTGIS_* di environment; "
            "tidak ada data pengganti yang disajikan."
        )
    return pg_fc


# ── API publik dipakai oleh main.py ──────────────────────────────────────────

def source_name() -> str:
    return "postgis" if _postgis_available() else "unavailable"


def health() -> Dict:
    reachable = _postgis_available()
    return {
        "status": "ok" if reachable else "degraded",
        "data_source": source_name(),
        "postgis_configured": bool(os.getenv("POSTGIS_PASSWORD")),
        "postgis_reachable": reachable,
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
    """Deret waktu per blok belum tersedia dari PostGIS (dulu dikarang sample)."""
    if get_block(block_id) is None:
        return None
    raise DataUnavailable("Deret waktu belum tersedia dari PostGIS.")


def get_summary() -> Dict:
    fc = _fc()
    by_priority: Dict[str, int] = {}
    total_area = 0.0
    for f in fc["features"]:
        p = f["properties"]
        key = p.get("priority_level") or "normal"
        by_priority[key] = by_priority.get(key, 0) + 1
        total_area += float(p.get("area_ha") or 0)
    return {
        "n_blocks": len(fc["features"]),
        "total_area_ha": round(total_area, 1),
        "by_priority": by_priority,
        "data_source": source_name(),
    }

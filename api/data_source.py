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


def _fc() -> Dict:
    return json.loads(_sample_fc())


# ── API publik dipakai oleh main.py ──────────────────────────────────────────

def source_name() -> str:
    # TODO: kembalikan "postgis" setelah pembacaan dari block_conditions
    # diimplementasikan. Untuk saat ini data selalu dari sample generator,
    # jadi label harus jujur menyebut "sample" walau DB terjangkau.
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

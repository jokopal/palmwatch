"""
scripts/generate_seed.py
========================
Hasilkan supabase/seed.sql dari generator data sample (api/sample_data.py),
sehingga basis data Supabase langsung berisi blok + NDVI/LST/curah hujan +
kondisi + intervensi yang konsisten dengan demo.

Jalankan:
    python scripts/generate_seed.py
    # menulis -> supabase/seed.sql

Di produksi, seed ini digantikan oleh output pipeline GEE -> Supabase.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api import sample_data  # noqa: E402
OUT = ROOT / "supabase" / "seed.sql"


def sql_str(v) -> str:
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def sql_json(v) -> str:
    return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def sql_num(v) -> str:
    return "null" if v is None else str(v)


def main() -> None:
    fc = sample_data.build_feature_collection()
    lines: list[str] = []
    lines.append("-- PalmWatch seed data — DIHASILKAN OTOMATIS oleh scripts/generate_seed.py")
    lines.append("-- Jangan edit manual. Regenerasi: python scripts/generate_seed.py")
    lines.append("")
    lines.append("truncate table public.eo_readings, public.block_conditions, "
                 "public.soil_properties, public.blocks restart identity cascade;")
    lines.append("")

    for feat in fc["features"]:
        p = feat["properties"]
        bid = p["block_id"]
        geom = json.dumps(feat["geometry"], ensure_ascii=False).replace("'", "''")

        # ── blocks ──────────────────────────────────────────────────────
        lines.append(
            "insert into public.blocks "
            "(block_id, tenant_id, estate, area_ha, planting_year, variety, geom) values ("
            f"{sql_str(bid)}, 'demo', {sql_str(p['estate'])}, {sql_num(p['area_ha'])}, "
            f"{sql_num(p['planting_year'])}, {sql_str(p['variety'])}, "
            f"ST_SetSRID(ST_GeomFromGeoJSON('{geom}'), 4326));"
        )

        # ── soil_properties ─────────────────────────────────────────────
        lines.append(
            "insert into public.soil_properties (block_id, soil_ph, soil_soc) values ("
            f"{sql_str(bid)}, {sql_num(p['soil_ph'])}, {sql_num(p['soil_soc'])});"
        )

        # ── block_conditions (snapshot terbaru) ─────────────────────────
        lines.append(
            "insert into public.block_conditions "
            "(block_id, period_start, period_end, conditions, n_conditions, severity_score, "
            "priority_level, interventions, n_interventions, yield_baseline_ton_ha, "
            "yield_predicted_after_intervention, regression_r2, composite_score, intervention_rank) values ("
            f"{sql_str(bid)}, {sql_str(p['last_updated'])}, {sql_str(p['last_updated'])}, "
            f"{sql_json(p['conditions'])}, {sql_num(p['n_conditions'])}, {sql_num(p['severity_score'])}, "
            f"{sql_str(p['priority_level'])}, {sql_json(p['interventions'])}, {sql_num(p['n_interventions'])}, "
            f"{sql_num(p['yield_baseline_ton_ha'])}, {sql_num(p['yield_predicted_after_intervention'])}, "
            f"{sql_num(p['regression_r2'])}, {sql_num(p['composite_score'])}, {sql_num(p['intervention_rank'])});"
        )

        # ── eo_readings (24 bulan time-series) ──────────────────────────
        ts = sample_data.build_timeseries(bid)
        series = ts["series"]
        last_i = len(series) - 1
        for i, pt in enumerate(series):
            if i == last_i:
                # Baris terbaru = snapshot blok: selaraskan dengan properties
                # agar peta & panel konsisten, plus isi LST/LAI/curah-90d.
                ndvi, evi, rain30 = p["ndvi_value"], p["evi_value"], p["rainfall_30d_mm"]
                lst = sql_num(p["lst_celsius"])
                lai = sql_num(p["lai_value"])
                rain90 = sql_num(p["rainfall_90d_mm"])
            else:
                ndvi, evi, rain30 = pt["ndvi"], pt["evi"], pt["rainfall_30d_mm"]
                lst, lai, rain90 = "null", "null", "null"
            lines.append(
                "insert into public.eo_readings "
                "(block_id, obs_date, source, ndvi_mean, evi_mean, lai_mean, lst_celsius, "
                "rainfall_30d_mm, rainfall_90d_mm, tbs_ton_ha) values ("
                f"{sql_str(bid)}, {sql_str(pt['date'])}, 'composite_monthly', "
                f"{sql_num(ndvi)}, {sql_num(evi)}, {lai}, {lst}, "
                f"{sql_num(rain30)}, {rain90}, {sql_num(pt['tbs_ton_ha'])});"
            )
        lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8")
    n_blocks = len(fc["features"])
    print(f"Wrote {OUT} ({n_blocks} blok, {n_blocks * 24} baris eo_readings)")


if __name__ == "__main__":
    main()

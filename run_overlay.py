#!/usr/bin/env python
"""
run_overlay.py — Overlay engine KEYLESS: eo_readings -> block_conditions
========================================================================
Menutup mata rantai yang hilang di loop analitik. Track C (run_climate/run_soil/
run_ndvi/run_dem) mengisi `eo_readings` + `soil_properties`, tetapi TIDAK ada
yang menghitung kondisi & intervensi per blok — sehingga `block_conditions`
tetap kosong dan seluruh blok tampil 'normal' di dashboard.

Skrip ini membaca data EO yang sudah ada di DB (tanpa GEE, tanpa kredensial
apa pun selain SUPABASE_DB_URL), lalu MEMAKAI ULANG mesin agronomis yang sudah
teruji di `overlay.py`:
    tag_conditions()        — threshold berliteratur (thresholds.yaml)
    lookup_interventions()  — matriks kondisi -> intervensi + lag effect
    compute_composite_score()— ranking prioritas intervensi

Tiga keputusan metodologis (sengaja eksplisit):

1. AGREGASI LINTAS SOURCE. Satu periode bisa punya beberapa baris eo_readings
   dari source berbeda (open-meteo bulanan, sentinel-2-stac kuartalan). Nilai
   per variabel diambil dari baris mana pun yang punya nilai (mean bila lebih
   dari satu), bukan "baris terakhir" — sehingga NDVI tidak hilang hanya karena
   baris hujan lebih baru. Ini logika yang sama dengan migrasi 20260711000000.

2. CARRY-FORWARD variabel lambat. NDVI/EVI/LAI/LST/ET/kelembapan diamati lebih
   jarang daripada hujan. Nilai observasi terakhir dibawa maju (lalu mundur)
   dalam satu blok, sesuai kaidah blueprint "jangan pakai data PJ tanggal
   tunggal — pakai komposit/time-series". Hujan TIDAK di-carry-forward karena
   sudah berupa akumulasi 30/90 hari.

3. GATE REGRESI. yield_predicted_after_intervention hanya diisi bila regresi
   TBS~NDVI lolos gate (R2 >= 0.40 dan p < 0.05) dengan >= 12 periode. Bila
   tidak, kolom yield dibiarkan NULL dan dashboard menampilkan disclaimer
   "rekomendasi generik" — sesuai batasan di context.md.

Contoh:
    python run_overlay.py --project 00000000-0000-0000-0000-000000000001
    python run_overlay.py --project <uuid> --start 2024-01-01 --end 2024-12-31
    python run_overlay.py --project <uuid> --dry-run
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date

import pandas as pd
import psycopg2
from dotenv import load_dotenv

from normalizer import minmax_normalize
from overlay import compute_composite_score, lookup_interventions, tag_conditions
from postgis_writer import write_block_conditions
from utils.logger import get_logger

log = get_logger("run_overlay")

DEMO_PROJECT = "00000000-0000-0000-0000-000000000001"

# Kolom eo_readings yang dibaca (nama skema DB).
EO_COLUMNS = [
    "ndvi_mean", "evi_mean", "lai_mean", "fpar_mean", "lst_celsius",
    "temp_2m_mean", "rainfall_30d_mm", "rainfall_90d_mm",
    "et_stress_ratio", "soil_moisture", "tbs_ton_ha",
]

# Nama kolom DB -> nama kolom yang dipakai CONDITION_RULES di overlay.py.
DB_TO_RULES = {
    "rainfall_30d_mm": "rain_acc_30d",
    "rainfall_90d_mm": "rain_acc_90d",
    "soil_moisture": "soil_moisture_m3m3",
    "soil_ph": "soil_phh2o",
}

# Variabel yang boleh dibawa maju antar periode (observasi jarang).
CARRY_FORWARD = [
    "ndvi_mean", "evi_mean", "lai_mean", "fpar_mean",
    "lst_celsius", "et_stress_ratio", "soil_moisture",
]

# Kolom yang dinormalisasi untuk composite score (nama pasca-rename).
SCORE_VARS = [
    "ndvi_mean", "evi_mean", "lai_mean", "rain_acc_90d",
    "et_stress_ratio", "soil_moisture_m3m3", "soil_phh2o", "soil_soc",
]

# Target NDVI sehat untuk estimasi uplift (Srestasathiern et al., 2014).
NDVI_TARGET_SEHAT = 0.65
MIN_PERIODS_REGRESI = 12  # context.md: riwayat minimum untuk regresi


def db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("SUPABASE_DB_URL tidak diset (lihat .env).")
    return url


# ── Transformasi murni (dapat diuji tanpa DB) ────────────────────────────────

def aggregate_periods(eo: pd.DataFrame) -> pd.DataFrame:
    """
    Satukan baris eo_readings multi-source menjadi satu baris per (blok, periode).

    Periode = awal bulan dari obs_date. Untuk tiap variabel diambil rata-rata
    nilai yang TIDAK null lintas source, sehingga NDVI kuartalan dan hujan
    bulanan hidup berdampingan tanpa saling menimpa.
    """
    if eo.empty:
        return pd.DataFrame(columns=["block_id", "period_start", *EO_COLUMNS])

    df = eo.copy()
    df["obs_date"] = pd.to_datetime(df["obs_date"])
    df["period_start"] = df["obs_date"].values.astype("datetime64[M]")

    value_cols = [c for c in EO_COLUMNS if c in df.columns]
    agg = (
        df.groupby(["block_id", "period_start"], as_index=False)[value_cols]
        .mean()  # mean melewatkan NaN — nilai dari source mana pun terpakai
        .sort_values(["block_id", "period_start"])
        .reset_index(drop=True)
    )
    return agg


def carry_forward_slow_vars(agg: pd.DataFrame) -> pd.DataFrame:
    """Bawa maju (lalu mundur) variabel yang diamati jarang, per blok."""
    if agg.empty:
        return agg
    out = agg.sort_values(["block_id", "period_start"]).copy()
    cols = [c for c in CARRY_FORWARD if c in out.columns]
    if cols:
        grouped = out.groupby("block_id")[cols]
        out[cols] = grouped.ffill()
        out[cols] = out.groupby("block_id")[cols].bfill()
    return out


def build_feature_frame(
    agg: pd.DataFrame,
    soil: pd.DataFrame,
) -> pd.DataFrame:
    """Gabungkan EO per periode + tanah statis, lalu rename ke nama CONDITION_RULES."""
    df = agg.copy()
    if not soil.empty:
        df = df.merge(soil, on="block_id", how="left")
    return df.rename(columns=DB_TO_RULES)


def regression_gate(series: pd.DataFrame) -> dict:
    """
    Regresi TBS ~ NDVI untuk satu blok. Mengembalikan dict berisi r2, slope,
    dan status gate. Bila data tak cukup, semua None (bukan angka karangan).
    """
    empty = {"regression_r2": None, "slope": None, "passes_gate": False, "n": 0}
    if "tbs_ton_ha" not in series.columns or "ndvi_mean" not in series.columns:
        return empty

    pair = series[["ndvi_mean", "tbs_ton_ha"]].dropna()
    if len(pair) < MIN_PERIODS_REGRESI:
        return {**empty, "n": len(pair)}

    from api.infrastructure.regression import validate_regression

    res = validate_regression(
        pair["tbs_ton_ha"].to_numpy(),
        pair["ndvi_mean"].to_numpy(),
        variable_name="ndvi_mean",
    )
    return {
        "regression_r2": round(float(res.r_squared), 3),
        "slope": float(res.slope),
        "passes_gate": bool(res.passes_gate),
        "n": len(pair),
    }


def estimate_yield(block_rows: pd.DataFrame, reg: dict) -> dict:
    """
    Baseline & proyeksi yield untuk satu blok.

    Baseline  = rata-rata TBS teramati.
    Proyeksi  = baseline + slope * (NDVI target sehat - NDVI terkini), HANYA bila
                regresi lolos gate. Di luar itu None -> UI menampilkan disclaimer.
    """
    out = {"yield_baseline_ton_ha": None, "yield_predicted_after_intervention": None}
    if "tbs_ton_ha" not in block_rows.columns:
        return out
    tbs = block_rows["tbs_ton_ha"].dropna()
    if tbs.empty:
        return out

    baseline = round(float(tbs.mean()), 2)
    out["yield_baseline_ton_ha"] = baseline

    if not reg.get("passes_gate") or reg.get("slope") is None:
        return out

    ndvi_now = block_rows["ndvi_mean"].dropna()
    if ndvi_now.empty:
        return out
    gap = max(0.0, NDVI_TARGET_SEHAT - float(ndvi_now.iloc[-1]))
    predicted = baseline + float(reg["slope"]) * gap
    out["yield_predicted_after_intervention"] = round(max(predicted, baseline), 2)
    return out


def score_by_period(df: pd.DataFrame) -> pd.DataFrame:
    """
    Composite score + ranking prioritas, dihitung PER PERIODE (bukan lintas
    periode) agar ranking membandingkan blok pada waktu yang sama.
    """
    cols = [c for c in SCORE_VARS if c in df.columns]
    parts = []
    for period, group in df.groupby("period_start", sort=True):
        g = group.copy()
        if cols:
            g, _ = minmax_normalize(g, cols)
        g = compute_composite_score(g)
        parts.append(g)
    return pd.concat(parts, ignore_index=True) if parts else df


def attach_yield_and_regression(df: pd.DataFrame) -> pd.DataFrame:
    """Hitung regresi & proyeksi yield per blok, lalu tempelkan ke semua periodenya."""
    out = df.copy()
    for col in ("regression_r2", "yield_baseline_ton_ha", "yield_predicted_after_intervention"):
        out[col] = None

    for block_id, rows in out.groupby("block_id"):
        ordered = rows.sort_values("period_start")
        reg = regression_gate(ordered)
        yields = estimate_yield(ordered, reg)
        mask = out["block_id"] == block_id
        out.loc[mask, "regression_r2"] = reg["regression_r2"]
        out.loc[mask, "yield_baseline_ton_ha"] = yields["yield_baseline_ton_ha"]
        out.loc[mask, "yield_predicted_after_intervention"] = yields["yield_predicted_after_intervention"]
    return out


def run_overlay_frame(eo: pd.DataFrame, soil: pd.DataFrame) -> pd.DataFrame:
    """
    Pipeline murni: eo_readings + soil_properties -> baris block_conditions.
    Dipisahkan dari I/O agar dapat diuji tanpa database.
    """
    agg = aggregate_periods(eo)
    if agg.empty:
        return pd.DataFrame()

    agg = carry_forward_slow_vars(agg)
    feats = build_feature_frame(agg, soil)

    tagged = tag_conditions(feats)
    with_interventions = lookup_interventions(tagged)
    scored = score_by_period(with_interventions)
    final = attach_yield_and_regression(scored)

    # priority_level dari pd.cut bertipe Categorical — DB butuh text.
    final["priority_level"] = final["priority_level"].astype(str)
    # period_end = hari terakhir bulan periode.
    final["period_end"] = (
        pd.to_datetime(final["period_start"]) + pd.offsets.MonthEnd(1)
    ).dt.date
    final["period_start"] = pd.to_datetime(final["period_start"]).dt.date
    return final


# ── I/O ──────────────────────────────────────────────────────────────────────

def load_inputs(
    conn,
    project_id: str,
    start: date | None,
    end: date | None,
    exclude_sources: list[str] | None = None,
):
    """Baca eo_readings + soil_properties untuk semua blok satu project."""
    cur = conn.cursor()
    cur.execute("select block_id from public.blocks where project_id=%s order by block_id",
                (project_id,))
    block_ids = [r[0] for r in cur.fetchall()]
    if not block_ids:
        sys.exit(f"Tidak ada blok untuk project {project_id}.")

    where = ["block_id = any(%s)"]
    params: list = [block_ids]
    if start:
        where.append("obs_date >= %s")
        params.append(start)
    if end:
        where.append("obs_date <= %s")
        params.append(end)
    if exclude_sources:
        # Cegah data seed sintetis tercampur dengan observasi nyata.
        where.append("coalesce(source,'') <> all(%s)")
        params.append(exclude_sources)

    cur.execute(
        f"select block_id, obs_date, {', '.join(EO_COLUMNS)} "
        f"from public.eo_readings where {' and '.join(where)}",
        params,
    )
    eo = pd.DataFrame(cur.fetchall(), columns=["block_id", "obs_date", *EO_COLUMNS])

    cur.execute(
        "select block_id, soil_ph, soil_soc from public.soil_properties "
        "where block_id = any(%s)",
        (block_ids,),
    )
    soil = pd.DataFrame(cur.fetchall(), columns=["block_id", "soil_ph", "soil_soc"])
    return block_ids, eo, soil


def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser(
        description="PalmWatch — overlay keyless: eo_readings -> block_conditions")
    ap.add_argument("--project", default=DEMO_PROJECT)
    ap.add_argument("--start", default=None, help="YYYY-MM-DD (opsional)")
    ap.add_argument("--end", default=None, help="YYYY-MM-DD (opsional)")
    ap.add_argument("--tenant", default="demo")
    ap.add_argument("--exclude-source", action="append", default=[],
                    help="Abaikan source eo_readings tertentu (boleh diulang). "
                         "Gunakan untuk menyingkirkan data seed sintetis, mis. "
                         "--exclude-source Sentinel-2")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    start = date.fromisoformat(args.start) if args.start else None
    end = date.fromisoformat(args.end) if args.end else None

    conn = psycopg2.connect(db_url())
    conn.autocommit = True
    block_ids, eo, soil = load_inputs(conn, args.project, start, end, args.exclude_source)
    print(f"[OVERLAY] {len(block_ids)} blok - {len(eo)} baris eo_readings - "
          f"{len(soil)} baris tanah"
          + (f" - source dikecualikan: {', '.join(args.exclude_source)}"
             if args.exclude_source else ""))
    if eo.empty:
        sys.exit("eo_readings kosong untuk rentang ini. Jalankan run_climate.py / "
                 "run_ndvi.py / run_soil.py dulu.")

    rows = run_overlay_frame(eo, soil)
    if rows.empty:
        sys.exit("Tidak ada periode yang bisa dinilai.")

    n_periods = rows["period_start"].nunique()
    dist = rows.groupby("priority_level").size().to_dict()
    n_interv = int((rows["n_interventions"] > 0).sum())
    print(f"[OVERLAY] {len(rows)} baris kondisi ({n_periods} periode) - "
          f"sebaran prioritas {dist} - {n_interv} baris dengan intervensi")

    valid_r2 = rows["regression_r2"].dropna()
    if valid_r2.empty:
        print("[OVERLAY] Regresi TBS~NDVI dilewati (butuh >= 12 periode dengan "
              "tbs_ton_ha). yield/R2 dibiarkan NULL — dashboard akan menampilkan "
              "rekomendasi generik + disclaimer.")
    else:
        print(f"[OVERLAY] R2 TBS~NDVI: median {valid_r2.median():.2f} "
              f"({len(valid_r2.unique())} blok dinilai)")

    if args.dry_run:
        preview = rows[["block_id", "period_start", "n_conditions", "severity_score",
                        "priority_level", "n_interventions", "composite_score"]]
        print(preview.head(12).to_string(index=False))
        print("(dry-run — tidak menulis)")
        return

    n = write_block_conditions(rows, args.tenant)
    print(f"[OVERLAY] SELESAI — {n} baris di-upsert ke block_conditions "
          f"(idempoten per block_id+period_start).")
    conn.close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python
"""
run_climate.py — Track C1: Curah hujan & suhu udara (Open-Meteo) -> eo_readings
==============================================================================
Pengganti CHIRPS/GEE untuk curah hujan + suhu, MANDIRI via REST API gratis
(Open-Meteo Archive, tanpa API key). Query hanya di CENTROID tiap blok project
— clip ke AOI, bukan seluruh peta — sehingga ringan & cepat.

Menulis rainfall_30d_mm, rainfall_90d_mm, temp_2m_mean per blok per obs_date
(bulanan) ke public.eo_readings dengan source='open-meteo'.

Contoh:
    python run_climate.py --project 00000000-0000-0000-0000-000000000001 \
        --start 2024-01-01 --end 2024-12-31
    python run_climate.py --project <uuid> --dry-run
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date, timedelta

import requests
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
DEMO_PROJECT = "00000000-0000-0000-0000-000000000001"


def db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("SUPABASE_DB_URL tidak diset (lihat .env).")
    return url


def month_starts(start: date, end: date) -> list[date]:
    """Tanggal observasi = awal tiap bulan dalam [start, end]."""
    y, m, out = start.year, start.month, []
    while date(y, m, 1) <= end:
        d = date(y, m, 1)
        if d >= start:
            out.append(d)
        m += 1
        if m > 12:
            m, y = 1, y + 1
    return out


def fetch_daily(lat: float, lon: float, start: date, end: date) -> dict[date, tuple]:
    """Precip harian (mm) + suhu udara 2 m (°C) dari Open-Meteo Archive."""
    r = requests.get(ARCHIVE_URL, params={
        "latitude": lat, "longitude": lon,
        "start_date": start.isoformat(), "end_date": end.isoformat(),
        "daily": "precipitation_sum,temperature_2m_mean",
        "timezone": "UTC",
    }, timeout=60)
    r.raise_for_status()
    d = r.json().get("daily", {})
    return {
        date.fromisoformat(t): (p, tm)
        for t, p, tm in zip(d.get("time", []), d.get("precipitation_sum", []), d.get("temperature_2m_mean", []))
    }


def window_sum(daily: dict, end_d: date, days: int):
    start_d = end_d - timedelta(days=days)
    vals = [v[0] for dt, v in daily.items() if start_d < dt <= end_d and v[0] is not None]
    return round(sum(vals), 2) if vals else None


def window_mean_temp(daily: dict, end_d: date, days: int = 30):
    start_d = end_d - timedelta(days=days)
    vals = [v[1] for dt, v in daily.items() if start_d < dt <= end_d and v[1] is not None]
    return round(sum(vals) / len(vals), 2) if vals else None


def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser(description="PalmWatch C1 — Open-Meteo climate -> eo_readings")
    ap.add_argument("--project", default=DEMO_PROJECT)
    ap.add_argument("--start", default="2024-01-01")
    ap.add_argument("--end", default="2024-12-31")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    conn = psycopg2.connect(db_url())
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        """select block_id, ST_X(ST_Centroid(geom)), ST_Y(ST_Centroid(geom))
           from public.blocks where project_id=%s order by block_id""",
        (args.project,),
    )
    blocks = cur.fetchall()
    if not blocks:
        sys.exit(f"Tidak ada blok untuk project {args.project}.")
    print(f"[C1] {len(blocks)} blok - {args.start}..{args.end} - sumber Open-Meteo Archive (per-centroid, clip AOI)")

    obs_dates = month_starts(start, end)
    fetch_start = start - timedelta(days=95)  # lead 90 hari untuk rainfall_90d
    rows = []
    for bid, lon, lat in blocks:
        try:
            daily = fetch_daily(lat, lon, fetch_start, end)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {bid}: gagal fetch ({e})")
            continue
        n = 0
        for od in obs_dates:
            r30, r90, t = window_sum(daily, od, 30), window_sum(daily, od, 90), window_mean_temp(daily, od, 30)
            if r30 is None and t is None:
                continue
            rows.append((bid, od, "open-meteo", r30, r90, t))
            n += 1
        print(f"  - {bid} ({lat:.3f},{lon:.3f}) -> {n} obs")
        time.sleep(0.3)  # sopan ke API gratis

    print(f"[C1] {len(rows)} baris siap.")
    if args.dry_run:
        for r in rows[:6]:
            print("   ", r)
        print("(dry-run — tidak menulis)")
        return

    execute_values(cur, """
        insert into public.eo_readings
          (block_id, obs_date, source, rainfall_30d_mm, rainfall_90d_mm, temp_2m_mean)
        values %s
        on conflict (block_id, obs_date, source) do update set
          rainfall_30d_mm = excluded.rainfall_30d_mm,
          rainfall_90d_mm = excluded.rainfall_90d_mm,
          temp_2m_mean    = excluded.temp_2m_mean
    """, rows)
    print(f"[C1] SELESAI — {len(rows)} baris di-upsert ke eo_readings (source=open-meteo).")
    conn.close()


if __name__ == "__main__":
    main()

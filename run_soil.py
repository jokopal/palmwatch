#!/usr/bin/env python
"""
run_soil.py — Track C2: Properti tanah (SoilGrids ISRIC) -> soil_properties
===========================================================================
Pengganti sifat tanah GEE, MANDIRI via REST API gratis (SoilGrids v2.0 ISRIC,
tanpa key). Query hanya di CENTROID tiap blok project (clip ke AOI). Menulis
pH, SOC, clay, sand, CEC, nitrogen (kedalaman 0-5cm, nilai mean) ke
public.soil_properties.

Catatan: SoilGrids membatasi ~5 permintaan/menit — skrip men-throttle & retry 429.

Contoh:
    python run_soil.py --project 00000000-0000-0000-0000-000000000001
    python run_soil.py --project <uuid> --dry-run
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone

import requests
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

SOILGRIDS_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
DEMO_PROJECT = "00000000-0000-0000-0000-000000000001"

# SoilGrids property -> (kolom DB, nama SoilGrids). Konversi = value / d_factor.
PROPS = {
    "phh2o":    "soil_ph",
    "soc":      "soil_soc",
    "clay":     "soil_clay",
    "sand":     "soil_sand",
    "cec":      "soil_cec",
    "nitrogen": "soil_nitrogen",
}


def db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("SUPABASE_DB_URL tidak diset (lihat .env).")
    return url


def fetch_soil(lat: float, lon: float, retries: int = 4) -> dict[str, float]:
    """Ambil sifat tanah 0-5cm (mean) di titik. Retry saat 429/timeout."""
    params = [("lon", lon), ("lat", lat), ("depth", "0-5cm"), ("value", "mean")]
    params += [("property", p) for p in PROPS]
    for attempt in range(retries):
        try:
            r = requests.get(SOILGRIDS_URL, params=params, timeout=60)
            if r.status_code == 429:
                wait = 15 * (attempt + 1)
                print(f"    (429 rate-limit, tunggu {wait}s)")
                time.sleep(wait)
                continue
            r.raise_for_status()
            out: dict[str, float] = {}
            for layer in r.json().get("properties", {}).get("layers", []):
                name = layer["name"]
                col = PROPS.get(name)
                if not col:
                    continue
                d_factor = layer.get("unit_measure", {}).get("d_factor", 1) or 1
                mean = layer["depths"][0]["values"].get("mean")
                if mean is not None:
                    out[col] = round(mean / d_factor, 3)
            return out
        except requests.RequestException as e:
            if attempt == retries - 1:
                raise
            print(f"    (gagal, retry {attempt + 1}: {e})")
            time.sleep(10)
    return {}


def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser(description="PalmWatch C2 — SoilGrids -> soil_properties")
    ap.add_argument("--project", default=DEMO_PROJECT)
    ap.add_argument("--throttle", type=float, default=13.0, help="jeda antar-blok (detik)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

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
    print(f"[C2] {len(blocks)} blok - SoilGrids v2.0 (per-centroid, clip AOI, throttle {args.throttle}s)")

    now = datetime.now(timezone.utc)
    rows = []
    for i, (bid, lon, lat) in enumerate(blocks):
        try:
            soil = fetch_soil(lat, lon)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {bid}: gagal ({e})")
            continue
        if not soil:
            print(f"  ! {bid}: kosong")
            continue
        rows.append((
            bid, soil.get("soil_ph"), soil.get("soil_soc"), soil.get("soil_clay"),
            soil.get("soil_sand"), soil.get("soil_cec"), soil.get("soil_nitrogen"), now,
        ))
        print(f"  - {bid} ({lat:.3f},{lon:.3f}) -> pH {soil.get('soil_ph')} SOC {soil.get('soil_soc')} clay {soil.get('soil_clay')}%")
        if i < len(blocks) - 1:
            time.sleep(args.throttle)

    print(f"[C2] {len(rows)} baris siap.")
    if args.dry_run:
        print("(dry-run — tidak menulis)")
        return

    execute_values(cur, """
        insert into public.soil_properties
          (block_id, soil_ph, soil_soc, soil_clay, soil_sand, soil_cec, soil_nitrogen, updated_at)
        values %s
        on conflict (block_id) do update set
          soil_ph=excluded.soil_ph, soil_soc=excluded.soil_soc, soil_clay=excluded.soil_clay,
          soil_sand=excluded.soil_sand, soil_cec=excluded.soil_cec,
          soil_nitrogen=excluded.soil_nitrogen, updated_at=excluded.updated_at
    """, rows)
    print(f"[C2] SELESAI — {len(rows)} baris di-upsert ke soil_properties (SoilGrids).")
    conn.close()


if __name__ == "__main__":
    main()

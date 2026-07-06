"""
run_gee.py
==========
Jalankan pipeline GEE untuk SATU project — blok (batas) diambil dari Supabase,
aset katalog global (Sentinel-2, MODIS, CHIRPS, SoilGrids, SRTM) di-zonal-stats
tepat pada batas tiap blok, hasil (eo_readings + block_conditions) ditulis balik
ke Supabase `public`.

PRASYARAT:
    pip install earthengine-api            # GEE Python API
    earthengine authenticate               # atau service account (GEE_KEY_FILE)
    # .env: SUPABASE_DB_URL + GEE_SERVICE_ACCOUNT/GEE_KEY_FILE/GEE_PROJECT

CONTOH:
    python run_gee.py --project 00000000-0000-0000-0000-000000000001 \
        --start 2024-01-01 --end 2024-06-30

    # dry-run (tanpa tulis DB)
    python run_gee.py --project <uuid> --start 2024-01-01 --end 2024-03-31 --dry-run

Daftar aset katalog global yang dipakai: lihat GEE_DATASETS.md.
"""

from __future__ import annotations

import argparse
import json
import sys

from dotenv import load_dotenv

load_dotenv()


def main() -> None:
    ap = argparse.ArgumentParser(description="PalmWatch GEE pipeline per project")
    ap.add_argument("--project", required=True, help="UUID project di Supabase")
    ap.add_argument("--start", required=True, help="YYYY-MM-DD awal periode")
    ap.add_argument("--end", required=True, help="YYYY-MM-DD akhir periode")
    ap.add_argument("--skip-static", action="store_true", help="Skip tanah/topografi")
    ap.add_argument("--dry-run", action="store_true", help="Jangan tulis ke DB")
    args = ap.parse_args()

    # Load batas blok project dari Supabase (masking boundary untuk GEE).
    from utils.supabase_blocks import load_project_blocks

    gdf = load_project_blocks(args.project)
    if len(gdf) == 0:
        print(f"ERROR: tidak ada blok untuk project {args.project}. "
              f"Import batas blok dulu (tab Upload).")
        sys.exit(1)
    print(f"Loaded {len(gdf)} blok dari project {args.project}")

    # Import pipeline setelah blok siap (agar error GEE/ee lebih jelas).
    from pipeline import run_phase1

    summary = run_phase1(
        blocks_gdf=gdf,
        tenant_id=args.project,
        start_date=args.start,
        end_date=args.end,
        skip_static=args.skip_static,
        skip_db_write=args.dry_run,
    )
    print("\n=== SUMMARY ===")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()

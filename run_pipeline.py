"""
run_pipeline.py
================
Entry point CLI untuk menjalankan PalmWatch Fase 1 Pipeline.

CONTOH PENGGUNAAN:
------------------
# Full run
python run_pipeline.py \
    --blocks data/blocks_kalimantan.geojson \
    --tenant  pt_sawit_maju \
    --start   2024-01-01 \
    --end     2024-06-30

# Skip static data (sudah ada di DB dari run sebelumnya)
python run_pipeline.py \
    --blocks data/blocks_kalimantan.geojson \
    --tenant  pt_sawit_maju \
    --start   2024-07-01 \
    --end     2024-12-31 \
    --skip-static

# Dry run — tidak tulis ke DB, export saja ke CSV/GeoJSON
python run_pipeline.py \
    --blocks  data/blocks_kalimantan.geojson \
    --tenant  pt_sawit_maju \
    --start   2024-01-01 \
    --end     2024-03-31 \
    --dry-run \
    --output  results/dryrun/
"""

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def main():
    parser = argparse.ArgumentParser(
        description="PalmWatch Phase 1 Data Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--blocks",       required=True, help="Path ke GeoJSON/Shapefile blok polygon")
    parser.add_argument("--tenant",       required=True, help="ID tenant/perusahaan (huruf kecil, underscore)")
    parser.add_argument("--start",        required=True, help="Tanggal awal YYYY-MM-DD")
    parser.add_argument("--end",          required=True, help="Tanggal akhir YYYY-MM-DD")
    parser.add_argument("--output",       default="results/", help="Direktori output (default: results/)")
    parser.add_argument("--skip-static",  action="store_true", help="Skip akuisisi data tanah dan topografi")
    parser.add_argument("--dry-run",      action="store_true", help="Jangan tulis ke database")
    args = parser.parse_args()

    # Validasi file input
    if not Path(args.blocks).exists():
        print(f"ERROR: File blok tidak ditemukan: {args.blocks}")
        sys.exit(1)

    # Import setelah validasi (agar error lebih jelas)
    from pipeline import run_phase1

    summary = run_phase1(
        blocks_path=args.blocks,
        tenant_id=args.tenant,
        start_date=args.start,
        end_date=args.end,
        output_dir=args.output,
        skip_static=args.skip_static,
        skip_db_write=args.dry_run,
    )

    print("\n=== SUMMARY ===")
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()

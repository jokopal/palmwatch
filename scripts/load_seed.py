"""
scripts/load_seed.py
====================
Muat supabase/seed.sql ke database Supabase via psycopg2 (tanpa perlu psql).

Dipakai setelah `supabase db push` (skema sudah ada) untuk mengisi data demo.
Membaca connection string dari env `SUPABASE_DB_URL` (Supabase Dashboard ->
Settings -> Database -> Connection string -> URI).

Jalankan:
    python scripts/load_seed.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

SEED = ROOT / "supabase" / "seed.sql"


def main() -> None:
    db_url = os.getenv("SUPABASE_DB_URL")
    if not db_url:
        print("ERROR: set SUPABASE_DB_URL di .env "
              "(Settings -> Database -> Connection string -> URI)")
        sys.exit(1)
    if not SEED.exists():
        print(f"ERROR: {SEED} tidak ada. Jalankan: python scripts/generate_seed.py")
        sys.exit(1)

    try:
        import psycopg2
    except ImportError:
        print("ERROR: psycopg2 belum terinstal. pip install psycopg2-binary")
        sys.exit(1)

    sql = SEED.read_text(encoding="utf-8")
    print(f"Memuat {SEED.name} ke database Supabase...")
    conn = psycopg2.connect(db_url)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(sql)
            cur.execute("select count(*) from public.blocks;")
            n = cur.fetchone()[0]
        print(f"Seed berhasil. public.blocks berisi {n} baris.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

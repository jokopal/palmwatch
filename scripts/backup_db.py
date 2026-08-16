"""Backup logis seluruh skema `public` tanpa pg_dump.

Lingkungan pengembangan proyek ini tidak punya klien PostgreSQL terpasang,
sementara pekerjaan pembersihan data demo bersifat merusak dan tidak bisa
dibatalkan. Skrip ini menyediakan jaring pengaman yang setara untuk kebutuhan
itu: seluruh isi tabel disalin apa adanya.

Geometri PostGIS ditulis sebagai EWKT (`SRID=4326;POLYGON(...)`) supaya bisa
dibaca manusia sekaligus dipulihkan lewat ST_GeomFromEWKT.

Keluaran (folder bertimestamp di backups/):
    <tabel>.csv        salinan data
    restore.sql        INSERT siap jalan, urut sesuai dependensi
    manifest.json      jumlah baris per tabel untuk verifikasi

Pemakaian:
    python scripts/backup_db.py
    python scripts/backup_db.py --label sebelum-hapus-demo
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parent.parent
BACKUP_ROOT = ROOT / "backups"

# Urutan penulisan restore.sql: induk lebih dulu agar foreign key tidak gagal.
TABLE_ORDER = [
    "users", "projects", "project_members", "blocks", "block_conditions",
    "eo_readings", "soil_properties", "vector_layers", "raster_layers",
    "production_data", "analysis_results", "assets",
]

SKIP_TABLES = {"spatial_ref_sys"}  # tabel bawaan PostGIS, bukan data aplikasi


def sql_literal(v: object) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--label", default="", help="keterangan singkat untuk nama folder")
    args = ap.parse_args()

    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
    except ImportError:
        pass

    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        print("SUPABASE_DB_URL tidak diset.", file=sys.stderr)
        return 1

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    suffix = f"-{args.label}" if args.label else ""
    out = BACKUP_ROOT / f"{stamp}{suffix}"
    out.mkdir(parents=True, exist_ok=True)

    conn = psycopg2.connect(dsn)
    cur = conn.cursor()

    cur.execute(
        "select table_name from information_schema.tables "
        "where table_schema='public' and table_type='BASE TABLE' order by table_name"
    )
    tables = [t for (t,) in cur.fetchall() if t not in SKIP_TABLES]

    # Tabel yang tidak tercantum di TABLE_ORDER tetap ikut, ditaruh di belakang.
    ordered = [t for t in TABLE_ORDER if t in tables]
    ordered += [t for t in tables if t not in ordered]

    manifest: dict[str, int] = {}
    restore_lines = [
        "-- Restore data PalmWatch",
        f"-- Dibuat: {datetime.now().isoformat(timespec='seconds')}",
        "-- Jalankan pada skema yang strukturnya sudah ada (migrasi sudah ter-apply).",
        "begin;",
        "",
    ]

    for t in ordered:
        # Kolom geometry disalin sebagai EWKT agar tidak kehilangan SRID.
        cur.execute(
            "select column_name, udt_name from information_schema.columns "
            "where table_schema='public' and table_name=%s order by ordinal_position",
            (t,),
        )
        cols = cur.fetchall()
        select_parts, names = [], []
        for name, udt in cols:
            names.append(name)
            if udt in ("geometry", "geography"):
                select_parts.append(f'ST_AsEWKT("{name}") as "{name}"')
            else:
                select_parts.append(f'"{name}"')

        cur.execute(f'select {", ".join(select_parts)} from public."{t}"')
        rows = cur.fetchall()
        manifest[t] = len(rows)

        with (out / f"{t}.csv").open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(names)
            for r in rows:
                w.writerow(["" if v is None else v for v in r])

        if rows:
            geom_idx = {i for i, (_, udt) in enumerate(cols) if udt in ("geometry", "geography")}
            collist = ", ".join(f'"{n}"' for n in names)
            restore_lines.append(f"-- {t} ({len(rows)} baris)")
            for r in rows:
                vals = []
                for i, v in enumerate(r):
                    if i in geom_idx and v is not None:
                        vals.append(f"ST_GeomFromEWKT({sql_literal(v)})")
                    else:
                        vals.append(sql_literal(v))
                restore_lines.append(
                    f'insert into public."{t}" ({collist}) values ({", ".join(vals)});'
                )
            restore_lines.append("")

        print(f"  {t:<22} {len(rows):>6} baris")

    restore_lines.append("commit;")
    (out / "restore.sql").write_text("\n".join(restore_lines), encoding="utf-8")
    (out / "manifest.json").write_text(
        json.dumps({"created": datetime.now().isoformat(), "rows": manifest}, indent=2),
        encoding="utf-8",
    )

    total_kb = sum(f.stat().st_size for f in out.iterdir()) / 1024
    print(f"\nTotal {sum(manifest.values())} baris dari {len(ordered)} tabel, {total_kb:.0f} KB")
    print(f"Backup: {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

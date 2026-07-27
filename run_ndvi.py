#!/usr/bin/env python
"""
run_ndvi.py — Track C4: NDVI Sentinel-2 (STAC Planetary Computer) -> eo_readings
================================================================================
Pengganti NDVI GEE, MANDIRI via STAC keyless (Microsoft Planetary Computer).
Cari scene Sentinel-2 L2A paling sedikit awan per kuartal, baca band merah (B04)
& NIR (B08) HANYA pada jendela tiap blok (clip ke AOI via rasterio.mask — range
request COG, ringan), hitung NDVI rata-rata per blok, tulis ke eo_readings.ndvi_mean.

Sentinel-2 L2A baseline >= N0400 memakai BOA_ADD_OFFSET -1000 → reflektansi
= (DN - 1000)/10000; NDVI dihitung dari nilai ter-offset.

Contoh:
    python run_ndvi.py --project 00000000-0000-0000-0000-000000000001 --year 2024
    python run_ndvi.py --project <uuid> --year 2024 --max-cloud 40 --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date

import numpy as np
import requests
import rasterio
from rasterio.mask import mask as rio_mask
from rasterio.warp import transform_geom
from shapely.geometry import shape, mapping
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SIGN = "https://planetarycomputer.microsoft.com/api/sas/v1/sign"
DEMO_PROJECT = "00000000-0000-0000-0000-000000000001"
OFFSET = 1000.0  # BOA_ADD_OFFSET Sentinel-2 L2A baseline >= N0400


def db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("SUPABASE_DB_URL tidak diset (lihat .env).")
    return url


def sign(href: str) -> str:
    r = requests.get(SIGN, params={"href": href}, timeout=60)
    r.raise_for_status()
    return r.json()["href"]


def best_scene(bbox, start, end, max_cloud):
    """Scene paling sedikit awan dalam rentang; None bila tak ada."""
    body = {
        "collections": ["sentinel-2-l2a"], "bbox": bbox,
        "datetime": f"{start}/{end}",
        "query": {"eo:cloud_cover": {"lt": max_cloud}},
        "limit": 1, "sortby": [{"field": "properties.eo:cloud_cover", "direction": "asc"}],
    }
    r = requests.post(STAC, json=body, timeout=60)
    r.raise_for_status()
    feats = r.json().get("features", [])
    return feats[0] if feats else None


def zonal_ndvi(red_url, nir_url, blocks_wgs):
    """NDVI rata-rata per blok. blocks_wgs: list (block_id, shapely geom EPSG:4326)."""
    out = {}
    with rasterio.open(red_url) as red_src, rasterio.open(nir_url) as nir_src:
        dst_crs = red_src.crs
        for bid, geom in blocks_wgs:
            geom_proj = transform_geom("EPSG:4326", dst_crs, mapping(geom))
            try:
                red, _ = rio_mask(red_src, [geom_proj], crop=True, filled=True, nodata=0)
                nir, _ = rio_mask(nir_src, [geom_proj], crop=True, filled=True, nodata=0)
            except ValueError:
                continue  # blok di luar footprint scene
            r = red[0].astype("float32"); n = nir[0].astype("float32")
            valid = (r > 0) & (n > 0)
            if valid.sum() == 0:
                continue
            r = r[valid] - OFFSET; n = n[valid] - OFFSET
            denom = n + r
            ok = denom != 0
            if ok.sum() == 0:
                continue
            ndvi = (n[ok] - r[ok]) / denom[ok]
            ndvi = ndvi[(ndvi >= -1) & (ndvi <= 1)]
            if ndvi.size:
                out[bid] = round(float(np.mean(ndvi)), 4)
    return out


def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser(description="PalmWatch C4 — Sentinel-2 NDVI (STAC) -> eo_readings")
    ap.add_argument("--project", default=DEMO_PROJECT)
    ap.add_argument("--year", type=int, default=2024)
    ap.add_argument("--max-cloud", type=float, default=40.0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")

    conn = psycopg2.connect(db_url())
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        "select block_id, ST_AsGeoJSON(geom) from public.blocks where project_id=%s order by block_id",
        (args.project,),
    )
    rows = cur.fetchall()
    if not rows:
        sys.exit(f"Tidak ada blok untuk project {args.project}.")
    blocks_wgs = [(r[0], shape(json.loads(r[1]))) for r in rows]
    from shapely.ops import unary_union
    bbox = list(unary_union([g for _, g in blocks_wgs]).bounds)  # [minx,miny,maxx,maxy]
    print(f"[C4] {len(blocks_wgs)} blok - bbox {bbox} - Sentinel-2 L2A STAC (max cloud {args.max_cloud}%)")

    # Satu scene terbaik per kuartal
    quarters = [(f"{args.year}-01-01", f"{args.year}-03-31"),
                (f"{args.year}-04-01", f"{args.year}-06-30"),
                (f"{args.year}-07-01", f"{args.year}-09-30"),
                (f"{args.year}-10-01", f"{args.year}-12-31")]
    db_rows = []
    for qs, qe in quarters:
        scene = best_scene(bbox, qs, qe, args.max_cloud)
        if not scene:
            print(f"  - {qs[:7]}..{qe[:7]}: tidak ada scene < {args.max_cloud}% awan")
            continue
        sdate = scene["properties"]["datetime"][:10]
        cloud = round(scene["properties"].get("eo:cloud_cover", 0), 1)
        red_url = sign(scene["assets"]["B04"]["href"])
        nir_url = sign(scene["assets"]["B08"]["href"])
        ndvi = zonal_ndvi(red_url, nir_url, blocks_wgs)
        print(f"  - {sdate} (awan {cloud}%): NDVI utk {len(ndvi)}/{len(blocks_wgs)} blok")
        for bid, val in ndvi.items():
            db_rows.append((bid, date.fromisoformat(sdate), "sentinel-2-stac", val))

    print(f"[C4] {len(db_rows)} baris siap.")
    if args.dry_run:
        for r in db_rows[:8]:
            print("   ", r)
        print("(dry-run — tidak menulis)")
        return

    execute_values(cur, """
        insert into public.eo_readings (block_id, obs_date, source, ndvi_mean)
        values %s
        on conflict (block_id, obs_date, source) do update set ndvi_mean = excluded.ndvi_mean
    """, db_rows)
    print(f"[C4] SELESAI — {len(db_rows)} baris NDVI di-upsert ke eo_readings (sentinel-2-stac).")
    conn.close()


if __name__ == "__main__":
    main()

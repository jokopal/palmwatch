#!/usr/bin/env python
"""
run_dem.py — Track C3: DEM + drainase (Copernicus GLO-30) -> COG raster
=======================================================================
Pengganti DEM/drainase GEE, MANDIRI via Copernicus DEM GLO-30 (AWS open data,
tanpa key). Baca DEM HANYA pada bbox AOI project (clip — ringan, bukan global),
turunkan SLOPE (proxy drainase: makin curam makin cepat mengalir), tulis dua
Cloud-Optimized GeoTIFF: elevasi & slope.

Bila kredensial Storage tersedia (env SUPABASE_SERVICE_KEY), COG diunggah ke
bucket 'rasters' dan dicatat di public.raster_layers (langsung tampil di web,
di-clip ke boundary via toggle). Bila tidak, COG disimpan lokal + instruksi.

Prasyarat COG driver: GDAL >= 3.1 (tersedia via rasterio).

Contoh:
    python run_dem.py --project 00000000-0000-0000-0000-000000000001
    python run_dem.py --project <uuid> --outdir ./out_cog   # generate saja
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np
import requests
import rasterio
from rasterio.windows import from_bounds
from rasterio.merge import merge as rio_merge
from rasterio.warp import transform_bounds
from shapely.geometry import shape
from shapely.ops import unary_union
import psycopg2
from dotenv import load_dotenv

COP_BASE = "https://copernicus-dem-30m.s3.amazonaws.com"
DEMO_PROJECT = "00000000-0000-0000-0000-000000000001"


def db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        sys.exit("SUPABASE_DB_URL tidak diset (lihat .env).")
    return url


def cop_tile_url(lat_sw: int, lon_sw: int) -> str:
    ns = f"N{lat_sw:02d}" if lat_sw >= 0 else f"S{abs(lat_sw):02d}"
    ew = f"E{lon_sw:03d}" if lon_sw >= 0 else f"W{abs(lon_sw):03d}"
    name = f"Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM"
    return f"{COP_BASE}/{name}/{name}.tif"


def read_dem_aoi(bbox, buffer_deg=0.01):
    """Baca & mosaik tile Copernicus yang menyentuh bbox (diperluas buffer)."""
    minx, miny, maxx, maxy = bbox
    minx -= buffer_deg; miny -= buffer_deg; maxx += buffer_deg; maxy += buffer_deg
    tiles = []
    for lon in range(math.floor(minx), math.floor(maxx) + 1):
        for lat in range(math.floor(miny), math.floor(maxy) + 1):
            tiles.append(cop_tile_url(lat, lon))
    srcs = []
    for t in tiles:
        try:
            srcs.append(rasterio.open(t))
        except Exception as e:  # noqa: BLE001
            print(f"    (tile lewati {t.split('/')[-1]}: {e})")
    if not srcs:
        raise RuntimeError("Tak ada tile DEM terbaca untuk AOI.")
    if len(srcs) == 1:
        src = srcs[0]
        w = from_bounds(minx, miny, maxx, maxy, src.transform)
        arr = src.read(1, window=w).astype("float32")
        transform = src.window_transform(w)
        crs = src.crs
    else:
        mosaic, transform = rio_merge(srcs, bounds=(minx, miny, maxx, maxy))
        arr = mosaic[0].astype("float32")
        crs = srcs[0].crs
    for s in srcs:
        s.close()
    return arr, transform, crs


def slope_degrees(elev, transform):
    """Slope (derajat) dari DEM. Konversi resolusi derajat -> meter di ekuator."""
    px_deg = abs(transform.a)
    px_m = px_deg * 111_320.0  # ~m per derajat lon di ekuator
    dzdy, dzdx = np.gradient(elev, px_m, px_m)
    slope = np.degrees(np.arctan(np.sqrt(dzdx ** 2 + dzdy ** 2)))
    return slope.astype("float32")


def write_cog(path, arr, transform, crs, nodata):
    profile = {
        "driver": "COG", "dtype": "float32", "count": 1,
        "height": arr.shape[0], "width": arr.shape[1],
        "crs": crs, "transform": transform, "nodata": nodata,
        "compress": "DEFLATE", "blocksize": 512, "overviews": "AUTO",
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(arr, 1)


def upload_and_register(conn, project_id, path, name, category, colormap, vmin, vmax, bounds):
    """Unggah COG ke Storage + catat di raster_layers. Butuh SUPABASE_SERVICE_KEY."""
    sup_url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not (sup_url and key):
        return False, "SUPABASE_URL/SUPABASE_SERVICE_KEY tidak diset — lewati unggah."
    storage_path = f"{project_id}/{os.path.basename(path)}"
    with open(path, "rb") as f:
        r = requests.post(
            f"{sup_url}/storage/v1/object/rasters/{storage_path}",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "image/tiff",
                     "x-upsert": "true"},
            data=f.read(), timeout=120,
        )
    if r.status_code not in (200, 201):
        return False, f"Upload gagal {r.status_code}: {r.text[:120]}"
    cur = conn.cursor()
    cur.execute("""
        insert into public.raster_layers
          (project_id, name, storage_path, category, bounds, colormap, min_value, max_value)
        values (%s,%s,%s,%s,%s,%s,%s,%s)
    """, (project_id, name, storage_path, category, json.dumps(bounds), colormap, vmin, vmax))
    return True, storage_path


def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser(description="PalmWatch C3 — Copernicus DEM + slope -> COG")
    ap.add_argument("--project", default=DEMO_PROJECT)
    ap.add_argument("--outdir", default="./out_cog")
    args = ap.parse_args()
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.makedirs(args.outdir, exist_ok=True)

    conn = psycopg2.connect(db_url()); conn.autocommit = True; cur = conn.cursor()
    cur.execute("select ST_AsGeoJSON(geom) from public.blocks where project_id=%s", (args.project,))
    geoms = [shape(json.loads(r[0])) for r in cur.fetchall()]
    if not geoms:
        sys.exit(f"Tidak ada blok untuk project {args.project}.")
    bbox = list(unary_union(geoms).bounds)
    print(f"[C3] AOI bbox {bbox} - Copernicus GLO-30 (clip AOI, ~30 m)")

    elev, transform, crs = read_dem_aoi(bbox)
    elev = np.where(np.isfinite(elev), elev, -9999).astype("float32")
    print(f"[C3] DEM {elev.shape} - elevasi {float(elev[elev>-9999].min()):.1f}..{float(elev.max()):.1f} m")
    slope = slope_degrees(np.where(elev > -9999, elev, np.nan), transform)
    slope = np.where(np.isfinite(slope), slope, -9999).astype("float32")
    print(f"[C3] Slope (drainase) {float(slope[slope>-9999].min()):.2f}..{float(slope[slope>-9999].max()):.2f} deg")

    dem_path = os.path.join(args.outdir, "dem.tif")
    slope_path = os.path.join(args.outdir, "slope.tif")
    write_cog(dem_path, elev, transform, crs, -9999)
    write_cog(slope_path, slope, transform, crs, -9999)
    b = [float(x) for x in transform_bounds(crs, "EPSG:4326", *rasterio.transform.array_bounds(elev.shape[0], elev.shape[1], transform))]
    ev = elev[elev > -9999]; sv = slope[slope > -9999]
    print(f"[C3] COG ditulis: {dem_path} ({os.path.getsize(dem_path)//1024} KB), {slope_path} ({os.path.getsize(slope_path)//1024} KB)")

    for path, name, cat, cmap, vmin, vmax in [
        (dem_path, "DEM Elevasi (GLO-30)", "dem", "BrewerYlGn9", round(float(ev.min()), 1), round(float(ev.max()), 1)),
        (slope_path, "Slope / Drainase", "twi", "BrewerYlGnBu9", 0.0, round(float(np.percentile(sv, 95)), 1)),
    ]:
        ok, msg = upload_and_register(conn, args.project, path, name, cat, cmap, vmin, vmax, b)
        print(f"[C3] {'UPLOAD OK' if ok else 'lokal saja'}: {name} - {msg}")
    if not (os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")):
        print("[C3] Set SUPABASE_URL + SUPABASE_SERVICE_KEY di .env untuk unggah otomatis,\n"
              "     atau unggah COG lewat tab Upload (B2) sebagai admin.")
    conn.close()


if __name__ == "__main__":
    main()

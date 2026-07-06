# PalmWatch — Aset Katalog GEE (Global)

Layer analitik PalmWatch berasal dari **aset katalog global Google Earth Engine**
yang sudah tersedia publik. Setiap aset di-*zonal-stats* / **di-mask tepat pada
batas poligon blok project** (`public.blocks.geom`) oleh collector di
`gee_collector.py`, lalu ditulis ke `public.eo_readings`.

Referensi katalog:
- Google Earth Engine Data Catalog — https://developers.google.com/earth-engine/datasets/catalog
- GEE Community Catalog (awesome-gee) — https://gee-community-catalog.org/projects/

## Aset yang dipakai

| Elemen layer | Asset ID (GEE) | Resolusi | Frekuensi | Katalog |
|---|---|---|---|---|
| NDVI / EVI | `COPERNICUS/S2_SR_HARMONIZED` (Sentinel-2 SR) | 10 m | ~5 hari | [S2_SR_HARMONIZED](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED) |
| NDVI / EVI (fallback awan) | `LANDSAT/LC09/C02/T1_L2` (Landsat-9) | 30 m | 16 hari | [LC09 C02 T1_L2](https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LC09_C02_T1_L2) |
| LAI / FPAR | `MODIS/061/MCD15A3H` | 500 m | 4 hari | [MCD15A3H](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MCD15A3H) |
| Land Surface Temp (LST) | `MODIS/061/MOD11A1` | 1 km | harian | [MOD11A1](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD11A1) |
| Evapotranspirasi (ET) | `MODIS/061/MOD16A2` | 500 m | 8 hari | [MOD16A2](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD16A2) |
| Curah hujan | `UCSB-CHG/CHIRPS/DAILY` | ~5 km | harian | [CHIRPS DAILY](https://developers.google.com/earth-engine/datasets/catalog/UCSB-CHG_CHIRPS_DAILY) |
| SAR (backup awan) | `COPERNICUS/S1_GRD` (Sentinel-1) | 10 m | 6–12 hari | [S1_GRD](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S1_GRD) |
| Topografi (slope/TWI/HAND) | `USGS/SRTMGL1_003` (SRTM 30 m) | 30 m | statis | [SRTMGL1_003](https://developers.google.com/earth-engine/datasets/catalog/USGS_SRTMGL1_003) |
| Tanah (pH, SOC, tekstur) | SoilGrids 2.0 (ISRIC) via REST | 250 m | statis | [SoilGrids](https://gee-community-catalog.org/projects/isric/) |

## Alur masking per batas blok project

```
public.blocks (batas project)  ──ST_AsGeoJSON──▶  utils/supabase_blocks.load_project_blocks()
        │                                                   │ GeoDataFrame (EPSG:4326)
        ▼                                                   ▼
   run_gee.py  ──▶  pipeline.run_phase1(blocks_gdf=…)  ──▶  gee_collector.*  (ee.Image
   .reduceRegions / zonal stats DI DALAM tiap poligon blok)  ──▶  normalizer  ──▶  overlay
        │                                                                              │
        ▼                                                                              ▼
   public.eo_readings (NDVI/LST/hujan per blok/tanggal)          public.block_conditions
        └────────────────────────  dibaca RPC blocks_geojson  ──▶  dashboard / peta
```

## Menjalankan

```bash
pip install earthengine-api
earthengine authenticate                 # atau service account (GEE_KEY_FILE di .env)
python run_gee.py --project <uuid> --start 2024-01-01 --end 2024-06-30
```

> Semua asset di atas **gratis & global**. Nilai per blok = statistik zonal di
> dalam batas poligon blok — bukan piksel tunggal (lihat batasan di `context.md`:
> minimal komposit 30 hari / time series).

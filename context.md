# PalmWatch — Project Context for AI Agents

> Gunakan file ini sebagai referensi utama saat bekerja pada proyek PalmWatch.
> Baca seluruh file sebelum memulai tugas apapun yang berkaitan dengan proyek ini.

---

## Identitas Produk

**Nama:** PalmWatch
**Tagline:** Precision Intelligence untuk Perkebunan Kelapa Sawit
**Tipe:** Platform SaaS berbasis web (Web App + Visual SIG + Data Lapangan)
**Domain:** Precision Agriculture, Remote Sensing, Geospatial Analytics
**Bahasa utama proyek:** Indonesia (konten, dokumen); Inggris (kode, skema database, API)

---

## Masalah yang Diselesaikan

Perusahaan dan petani sawit tidak dapat mengetahui **mengapa** produktivitas satu blok lebih rendah dari blok lain, dan tidak tahu **kapan** serta **bagaimana** cara intervensinya. Monitoring manual mahal, lambat, dan tidak berskala untuk ratusan ribu hektar.

---

## Solusi dan Pendekatan Inti

PalmWatch beroperasi dalam **lima fase loop analitik** yang membentuk siklus tertutup:

1. **Akuisisi data PJ dan open source** secara otomatis (temporal, per 10-16 hari)
2. **Normalisasi dan validasi regresi** terhadap data blok panen perusahaan
3. **Ground truth lapangan** untuk memperkuat model
4. **Overlay spasial** menghasilkan matriks intervensi per poligon blok
5. **Dashboard web SIG** menyajikan rekomendasi ke petani dan manajer kebun

**Kunci diferensiasi:** Intervensi hanya direkomendasikan setelah validasi statistik (R² >= 0.40, p < 0.05). Nilai slope regresi digunakan sebagai angka effort kuantitatif. Setiap rekomendasi dilengkapi lag effect berdasarkan literatur.

---

## Arsitektur Data

### Sumber Data Open Source (Temporal)

| Parameter | Sumber | Resolusi | Frekuensi |
|---|---|---|---|
| NDVI, EVI | Sentinel-2, Landsat-8/9 | 10-30m | 5-16 hari |
| LAI, FPAR | MODIS MCD15A3H | 500m | 4 hari |
| Land Surface Temperature | MODIS MOD11A1 | 1km | Harian |
| Curah hujan | CHIRPS, PERSIANN-CDR | 5km | Harian |
| Evapotranspirasi | MODIS MOD16A2 | 500m | 8 hari |
| Jenis tanah, pH, SOC, tekstur | SoilGrids 2.0 (ISRIC) | 250m | Statis |
| DEM, slope, TWI, HAND | SRTM 30m / NASADEM | 30m | Statis |
| SAR (backup cloud cover) | Sentinel-1 GRD | 10m | 6-12 hari |

**Pipeline:** Google Earth Engine (GEE) API → zonal statistics per blok polygon → PostGIS

### Data Milik Perusahaan (Input Klien)

- Polygon blok panen (GeoJSON / Shapefile)
- Atribut produksi TBS per blok per periode (ton/ha)
- Disimpan dalam skema terpisah per tenant (multi-tenancy)

### Data Lapangan (Ground Truth)

Dikumpulkan via form mobile PWA (offline-capable, GPS-tagged):
- Kelembaban tanah dan kanopi
- Jenis, dosis, dan jadwal pemupukan (N, P, K, Mg)
- Umur tanaman per blok (kohort)
- Observasi penyakit (Ganoderma BSR, BSDL, CSSD) dengan foto dan severity score
- Jarak tanam aktual dan densitas pohon per hektar
- Kondisi drainase aktual

---

## Stack Teknologi

### Backend
- **Bahasa:** Python (pipeline GEE, analisis statistik) + Node.js/FastAPI (API server)
- **Database:** PostgreSQL + PostGIS (spasial), Redis (caching)
- **GIS processing:** Google Earth Engine Python API, GDAL, Fiona, Shapely, GeoPandas
- **Statistik:** Scipy, Statsmodels (OLS, GWR), Scikit-learn (ML tahap lanjut)

### Frontend
- **Framework:** React (TypeScript)
- **Peta:** MapLibre GL JS atau Deck.gl
- **Chart:** Recharts atau D3.js
- **Mobile PWA:** React + Workbox (offline support)

### Infrastruktur
- **Cloud:** GCP atau AWS
- **Tile server:** PMTiles / Protomaps atau GeoServer
- **CI/CD:** GitHub Actions
- **Monitoring:** Sentry + Grafana

---

## Model Statistik dan Validasi

### Regresi Validasi (Fase 2)

```
Y = produksi TBS (ton/ha, per blok, per periode)
X = variabel PJ yang dinormalisasi (NDVI, curah hujan, dll.)

Model: OLS per variabel tunggal
Gate: R² >= 0.40 DAN p-value < 0.05 → variabel aktif
Lanjut: GWR (Geographically Weighted Regression) untuk heterogenitas spasial
```

**Interpretasi slope:** Slope regresi = estimasi perubahan produksi per unit perubahan variabel.
Contoh: slope NDVI = 8.2 berarti kenaikan NDVI 0.1 diperkirakan menambah ~0.82 ton/ha TBS.

### Threshold Tanaman

| Parameter | Kondisi Kritis | Kondisi Sehat | Sumber |
|---|---|---|---|
| NDVI (sawit dewasa) | < 0.45 | 0.45 - 0.75 | Srestasathiern et al., 2014 |
| NDVI (optimal) | - | > 0.75 | Chemura et al., 2017 |
| pH tanah | < 4.5 (asam kritis) | 4.8 - 5.5 | Fairhurst & Hardter, 2003 |
| Curah hujan bulanan | < 100mm (defisit) | 150 - 250mm | Corley & Tinker, 2003 |

---

## Matriks Intervensi

Format: `kombinasi_kondisi → intervensi → lag_effect → literatur`

| Kombinasi Layer | Intervensi | Lag Efek | Literatur |
|---|---|---|---|
| NDVI rendah + curah hujan rendah | Irigasi suplemen / mulching | 4-8 minggu | Corley & Tinker, 2003 |
| NDVI rendah + SOC rendah + N rendah | Pupuk N top-dress (Urea/ZA) | 3-6 bulan | Goh et al., 1999 |
| NDVI rendah + pH tanah < 4.5 | Pengapuran dolomit | 3-4 bulan | Fairhurst & Hardter, 2003 |
| LST tinggi + riwayat Ganoderma | Hexaconazole + fumigasi | 2-4 bulan | Idris et al., 2004 |
| LAI rendah + umur tanaman > 25 tahun | Replanting / gap infill | 3-4 tahun | Hartley, 1988 |
| TWI tinggi + ETP rendah | Perbaikan sistem drainase | 1-3 bulan | Paramananthan, 2000 |
| EVI rendah + jarak tanam rapat | Pruning + penjarangan | 2-3 bulan | Breure, 2003 |

**Catatan untuk agent:** Lag effect adalah estimasi berbasis literatur. Selalu tampilkan sebagai rentang (bukan angka tunggal) dan sertakan disclaimer bahwa kondisi lokal dapat mempengaruhi waktu respons aktual.

---

## Struktur Output GeoJSON per Blok

Setiap blok panen setelah overlay menghasilkan struktur berikut:

```json
{
  "block_id": "BLK-001",
  "area_ha": 42.5,
  "last_updated": "2025-06-01",
  "conditions": ["ndvi_low", "rainfall_deficit"],
  "ndvi_value": 0.38,
  "ndvi_status": "stress",
  "rainfall_30d_mm": 78,
  "interventions": [
    {
      "type": "irrigation",
      "priority": 1,
      "lag_weeks_min": 4,
      "lag_weeks_max": 8,
      "effort_score": 0.72,
      "literature": "Corley & Tinker, 2003"
    }
  ],
  "yield_baseline_ton_ha": 18.4,
  "yield_predicted_after_intervention": 21.2,
  "regression_r2": 0.61
}
```

---

## KPI Utama yang Harus Dipantau

### Produk
- Akurasi prediksi yield: R² >= 0.65 (target model akhir)
- Latensi update data PJ: < 48 jam dari tanggal akuisisi satelit
- Platform uptime: >= 99.5% per bulan

### Bisnis
- ARR target akhir tahun ke-2: Rp 5 miliar
- Klien aktif target tahun ke-2: 25+ perusahaan/koperasi
- Churn rate tahunan: < 10%

### Dampak Agronomis
- Peningkatan produktivitas blok intervensi: +15% vs baseline
- Pengurangan biaya input: -20% per hektar per tahun
- Akurasi alert kondisi kritis: >= 85%

---

## Segmen Pengguna

### Pengguna Utama (Primary)
- **Manajer kebun / agronomi perusahaan:** Butuh laporan kondisi kebun, rekomendasi intervensi per blok, dan tracking dampak intervensi.
- **Mandor lapangan:** Butuh instruksi sederhana berbasis lokasi, notifikasi push/SMS, form input lapangan yang mudah.

### Pengguna Sekunder
- **Direksi / manajemen perusahaan:** Butuh ringkasan eksekutif, tren produktivitas, dan proyeksi yield.
- **Petani plasma / koperasi:** Butuh antarmuka sederhana, mungkin via WhatsApp bot atau SMS.

---

## Konvensi Kode dan Proyek

### Penamaan
- Variabel Python: `snake_case`
- Komponen React: `PascalCase`
- Tabel database: `snake_case`, plural (contoh: `harvest_blocks`, `ndvi_readings`)
- GeoJSON field names: `snake_case`
- Skema per-tenant: `tenant_{company_id}`

### Satuan Baku
- Luas: hektar (ha)
- Produksi: ton TBS per hektar (ton/ha)
- Curah hujan: milimeter (mm)
- Temperatur: Celsius (°C)
- Koordinat: WGS84 (EPSG:4326) untuk penyimpanan; proyeksi lokal (UTM zone 47N/48N/49S) untuk kalkulasi jarak

### Periode Temporal
- Unit waktu terkecil untuk analisis: periode panen (biasanya bulan)
- Riwayat minimum untuk regresi: 12 periode (1 tahun)
- Riwayat ideal: 24-36 periode (2-3 tahun)

---

## Batasan dan Hal yang Harus Dihindari

- **Jangan** merekomendasikan intervensi jika model regresi belum valid (R² < 0.40 atau p >= 0.05). Gunakan rekomendasi generik agronomis sebagai fallback dan tampilkan disclaimer.
- **Jangan** menggunakan data PJ tunggal (satu tanggal saja) untuk analisis. Minimal gunakan komposit 30 hari atau time series.
- **Jangan** menyimpan koordinat GPS titik sampel lapangan di luar skema tenant yang sesuai (privasi data klien).
- **Jangan** membuat klaim produktivitas spesifik tanpa menyebut sumber literatur dan rentang ketidakpastian.
- **Jangan** hardcode threshold NDVI atau parameter agronomis lain. Semua threshold harus dapat dikonfigurasi per lokasi/varietas.

---

## Referensi Literatur Inti

- Corley, R.H.V. & Tinker, P.B. (2003). *The Oil Palm*, 4th ed. Blackwell Science.
- Fairhurst, T. & Hardter, R. (2003). *Oil Palm: Management for Large and Sustainable Yields*. PPIC/IPI.
- Goh, K.J. et al. (1999). Fertiliser recommendation systems for oil palm. *Proc. PORIM International Congress.*
- Srestasathiern, P. et al. (2014). Oil palm detection using remote sensing. *Journal of Applied Remote Sensing.*
- Chemura, A. et al. (2017). Separability of coffee leaf rust infection severity levels. *Remote Sensing.*
- Idris, A.S. et al. (2004). Ganoderma in oil palm: A review. *Mycopathologia.*
- Paramananthan, S. (2000). *Soils of Malaysia: their characteristics and identification*. Academy of Sciences Malaysia.
- Breure, C.J. (2003). The effect of palm age and planting density on the partitioning of assimilates. *Experimental Agriculture.*
- Hartley, C.W.S. (1988). *The Oil Palm*, 3rd ed. Longman.

---

## Status Proyek Saat Ini

**Fase:** Pra-MVP / Blueprint (Juni 2025) → Production Hardening (Juli 2026)
**Dokumen utama:** `PalmWatch_Blueprint_Konsep.docx`, `CONTEXT.md` (single source of truth)

**Yang sudah selesai:**
- Blueprint konsep lengkap (visi, misi, workflow, KPI, resources, roadmap, risiko)
- Arsitektur data dan parameter PJ terdefinisi
- Matriks intervensi dengan literatur acuan
- **Security sanitasi**: `.env.example` — semua kredensial Supabase asli dirotasi ke placeholder
- **Infrastruktur API**: `api/core/config.py` (pydantic-settings), `database.py` (SQLAlchemy pool), `logging.py` (structlog), `exceptions.py` (HTTP exceptions)
- **Domain schemas**: `api/domain/schemas.py` (Pydantic v2 untuk semua response)
- **Regression engine**: `api/infrastructure/regression.py` — OLS + GWR + InterventionGate
- **GEE client**: `api/infrastructure/gee.py` — resilient dengan caching
- **Cache layer**: `api/infrastructure/cache.py` — Redis + in-memory fallback
- **Threshold manager**: `api/domain/thresholds.py` — configurable per tenant
- **API server**: `api/main.py` — Sentry middleware, rate limiting (slowapi), structured error handling, regression + intervention endpoints
- **Utils package**: `utils/__init__.py`, `utils/logger.py` — JSON structured logger untuk pipeline scripts
- **CI/CD**: `.github/workflows/ci.yml` (lint + test-backend + test-frontend + docker build), `.github/workflows/deploy.yml` (Supabase migrasi + Fly.io deploy), `.github/workflows/keepalive.yml`
- **Containerization**: `Dockerfile` + `.dockerignore`
- **Dependencies**: `pyproject.toml` (ruff, mypy, pytest), `requirements-api.txt` (production), `requirements.txt` (pipeline + API gabungan)
- **Tests**: 61 tests, semuanya passing — `test_api.py`, `test_normalizer.py`, `test_overlay.py`, `test_regression.py`, `test_geometry.py`, `test_postgis_writer.py`, `test_overlay_keyless.py` (14)
- **Overlay engine keyless** (2026-08-06): `run_overlay.py` menghitung `block_conditions` dari `eo_readings`+`soil_properties` tanpa GEE — inilah jalur produksi kondisi/intervensi sekarang, bukan `pipeline.py` (yang masih butuh `earthengine-api`)

**Yang perlu dibangun:**
- Pipeline GEE → PostGIS (integrasi collectors/processors/storage dengan infra baru)
- Skema database migration via Alembic (menggantikan SQL manual)
- ✅ **RESOLVED (Jul 2026)** — Frontend GIS workspace (#2–#6): store peta terpusat (`web/src/store/mapStore.ts`), 5 basemap (default Esri Imagery, sync main+inset), multi-select layer manager, panel simbologi (single/categorized) + floating legend, insets-as-tool + per-inset choropleth, tab Upload SHP/GeoJSON → `vector_layers` (migrasi + RLS). Login username-only + sistem 3-font. Typecheck bersih. (Belum diverifikasi runtime: upload butuh sesi admin; render blok butuh seed DB.)
- Masih perlu: error boundaries, loading skeletons; render raster GEE (butuh tile pipeline)
- Mobile PWA ground truth form (offline-capable dengan geotagging)
- pre-commit hooks (ruff, mypy, pytest)
- ✅ **RESOLVED (Jul 2026)** — Arsitektur inconsistency: `pipeline.py` kini import langsung dari modul flat (`gee_collector`, `normalizer`, `overlay`, `postgis_writer`); `utils/geometry.py` (`load_blocks`) dibuat; `utils/logger.py` structured-logging API diperbaiki (dulu kwargs crash). 39 tests hijau. (Pipeline masih butuh `pip install earthengine-api` untuk run penuh.)
- ✅ **RESOLVED (Jul 2026)** — Schema inconsistency: `postgis_writer.py` di-refactor menargetkan skema `public` + kolom `tenant_id`, dengan UPSERT idempoten (`ON CONFLICT DO UPDATE`) dan pemetaan kolom pipeline→migrasi (`date/period_start`→`obs_date`, `rain_acc_30d`→`rainfall_30d_mm`, `soil_phh2o`→`soil_ph`, `conditions_list`→`conditions`). `init_schema` kini no-op (DDL dimiliki migrasi). Lapisan transform diuji + statement UPSERT diverifikasi compile (47 tests hijau). Eksekusi tulis end-to-end belum diverifikasi vs DB nyata (butuh pooler URL + `ee`).

---

*File ini diperbarui terakhir: Juni 2025. Selalu rujuk ke dokumen blueprint terbaru untuk detail lengkap.*

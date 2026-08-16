# PalmWatch — Web App (Fase 5: Dashboard SIG)

Dashboard web read-only untuk memvisualisasikan kondisi blok perkebunan sawit,
rekomendasi intervensi berbasis bukti, dan tren produktivitas — sesuai Fase 5
blueprint (*"Peta interaktif + time-series NDVI vs produksi TBS"*).

## Arsitektur

```
Browser (React + MapLibre + Recharts)  ──/api──▶  FastAPI  ──▶  PostGIS
        web/                                       api/        (atau fallback
                                                                 data sample)
```

- **`api/`** — FastAPI server. Membaca dari PostGIS bila variabel `POSTGIS_*`
  diset & DB hidup; jika tidak, fallback otomatis ke data sample deterministik
  (`api/sample_data.py`) — struktur persis skema GeoJSON di `context.md`.
- **`web/`** — Vite + React + TypeScript. MapLibre GL untuk peta, Recharts untuk
  time-series. Saat dev, `/api` di-proxy ke `localhost:8000` (lihat
  `vite.config.ts`).

## Menjalankan (mode demo, tanpa DB/GEE)

Butuh dua terminal.

**1. Backend (port 8000):**
```bash
pip install -r api/requirements-api.txt
uvicorn api.main:app --reload --port 8000
# Docs interaktif: http://localhost:8000/docs
```

**2. Frontend (port 5173):**
```bash
cd web
npm install
npm run dev
# Buka http://localhost:5173
```

Header KPI menampilkan badge `data: sample` saat fallback aktif, atau
`data: postgis` saat terhubung ke DB.

## Endpoint API

| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/health` | Status + sumber data aktif |
| GET | `/api/summary` | KPI: jumlah blok per priority, luas, mean R² |
| GET | `/api/blocks?priority=` | FeatureCollection GeoJSON semua blok |
| GET | `/api/blocks/{id}` | Detail satu blok |
| GET | `/api/blocks/{id}/timeseries` | Time-series bulanan NDVI/hujan/EVI vs TBS |

## Fitur dashboard

- Peta blok berwarna per `priority_level` (hijau→merah) + label + legenda.
- Filter priority (Semua / Kritis / Peringatan / Sehat).
- Klik blok → panel detail: metrik biofisik, kondisi aktif, rekomendasi
  intervensi (lag efek, effort score, literatur), proyeksi yield + disclaimer R².
- Chart time-series NDVI & TBS (sumbu kiri) vs curah hujan (sumbu kanan).

## Menghubungkan ke PostGIS asli

Set `POSTGIS_*` di `.env` (lihat `.env.example`) lalu jalankan pipeline Fase 1
agar tabel `block_conditions` & `eo_readings` terisi. `api/data_source.py` akan
otomatis beralih ke sumber `postgis` bila tabel terisi, atau fallback ke sample generator.
```

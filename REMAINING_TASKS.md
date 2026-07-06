# PalmWatch — Remaining Tasks

> File pelacak task hidup. **Diperbarui tiap ada task baru; item dihapus/dipindah ke
> "Selesai" saat rampung.** Sumber kebenaran prioritas pengembangan.
> Terakhir diperbarui: 2026-07-06.

---

## 🔵 Sedang dikerjakan

- _(kosong — pilih item berikutnya dari Todo)_

---

## 🔵 Sedang dikerjakan berikutnya

- [ ] **#2 Layer produksi = SHP boundary nyata (bukan "Harvest Blocks" default)**
  Perlakukan sebagai produksi: layer blok berasal dari boundary yang diupload/di-assign
  **per project** (kini `blocks.project_id` sudah ada dari #4). Butuh: workflow upload
  SHP → jadi blok project (bukan hanya vector_layers), hilangkan ketergantungan seed demo.

---

## 🟡 Todo (prioritas)

- [ ] **#5 3D view basemap + layer (elevation / z-index)**
  MapLibre 3D: terrain (DEM) + sky, ekstrusi layer mengikuti elevation/z-index,
  basemap 3D. Toggle 2D/3D. Layer & basemap mengikuti ketinggian.

- [ ] **#3 Role gating user vs admin** — *(HOLD atas permintaan user)*
  User = view-only; Admin = full (upload, edit simbologi, kelola project). Saat ini
  keduanya disamakan (`canUpload = any session`). Terapkan setelah #4 (project roles).

---

## 🟠 Backlog teknis (dari sesi sebelumnya)

- [ ] **Pipeline GEE nyata (Fase 1-4)**: `pip install earthengine-api` + service account
  (pilih "Data aplikasi"), jalankan pipeline → NDVI/LST asli ke Supabase `public`
  (postgis_writer sudah align).
- [ ] **Render raster GEE** di peta (kini GEE hanya list/legend — butuh tile pipeline).
- [ ] **Error Boundary + loading skeleton** (resiliensi UI).
- [ ] **CI GitHub Actions** (lint + test tiap push).
- [ ] 🔴 **Rotasi kredensial** yang sempat bocor: DB password `pakuntungpeduli123` +
  service_role/secret key. Setelah rotasi: update `.env`, `web/.env.local`,
  `web/src/config.ts`, env Netlify.

---

## ✅ Selesai (riwayat ringkas)

- [x] **#4 Project groups + share link** — tabel `projects` + `project_id` (blocks/
  vector_layers) + RLS + RPC (list/create/set_public/shared_project), scoping data per
  project, ProjectSwitcher header (switch/new/share), **share view publik read-only**
  (`?share=<token>`, tanpa login) untuk petani. Migrasi applied ke DB live + terverifikasi.
- [x] **#1 Bottom panel analisis** — `BottomPanel.tsx` dirombak jadi 3 tab pakai data
  NYATA (hapus mock): Attribute Table (join field layer aktif), Temporal (RPC
  block_timeseries), Conclusion (kondisi→intervensi→yield gate R²). Terverifikasi live.
- [x] Deploy Netlify: fix "no login / not-valid-JSON" — commit `config.ts` (URL+anon key
  publik) agar build tak bergantung env var Netlify; `persistSession`; cache headers.
- [x] Push GitHub `jokopal/palmwatch` (secret-scan bersih).
- [x] Seed Supabase live (12 blocks + 288 eo_readings, region ap-south-1).
- [x] GIS layer workspace #2-#6 (layer manager, symbology, basemap, insets, upload).
- [x] Login username-only + sistem 3-font.
- [x] Backend align schema `public` + `load_blocks` + structured logger (47 test hijau).

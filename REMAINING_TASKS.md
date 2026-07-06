# PalmWatch — Remaining Tasks

> File pelacak task hidup. **Diperbarui tiap ada task baru; item dihapus/dipindah ke
> "Selesai" saat rampung.** Sumber kebenaran prioritas pengembangan.
> Terakhir diperbarui: 2026-07-06.

---

## 🔵 Sedang dikerjakan

- _(kosong — pilih item berikutnya dari Todo)_

---

## 🟡 Todo (prioritas)

- [ ] **#2 Layer produksi = SHP boundary nyata (bukan "Harvest Blocks" default)**
  Perlakukan sebagai produksi: layer blok berasal dari boundary yang diupload/di-assign
  per project, bukan seed demo. Butuh: kaitkan `blocks`/boundary ke project, hilangkan
  ketergantungan layer default, workflow assign SHP → analitik.

- [ ] **#4 Project groups + switch/new project + share link**
  Model multi-project (beda kebun/estate). Menu switch project & new project di web.
  **Share link display** (read-only, tanpa login) agar petani bisa lihat via link.
  Butuh: tabel `projects` (+ `project_members`), scoping data per project, RLS,
  halaman publik `/share/:token`. Fondasi bisnis SaaS.

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

# PalmWatch — Remaining Tasks

> File pelacak task hidup. **Diperbarui tiap ada task baru; item dihapus/dipindah ke
> "Selesai" saat rampung.** Sumber kebenaran prioritas pengembangan.
> Terakhir diperbarui: 2026-07-06.

---

## 🔵 Sedang dikerjakan

- _(kosong — pilih item berikutnya dari Todo)_

---

## 🟡 Todo (prioritas)

- [ ] **Mobile/PWA + Raster mandiri + Data global (pengganti GEE)** — roadmap disepakati user.
  Urutan: A1 → B1 → C1 → A2 → B2 → C2 → C3 → C4.
  - ✅ **A1 Responsif SELESAI** (terverifikasi geometri di 375/768/1280px): `useMediaQuery`
    (`useIsMobile`, breakpoint ≤860px), `MobileShell` (peta layar-penuh + tab bar bawah
    Peta/Layer/Analisis) + `MobileSheet` (bottom-sheet fixed, setengah↔penuh, tutup). Reuse
    komponen desktop (MapView/LeftPanel/UserPanel/BottomPanel/AnalysisBar). Header ringkas
    (KPI & subjudul disembunyikan). `viewport-fit=cover` + `theme-color`. Desktop tak berubah.
    Catatan: sheet & tab bar `position:fixed` (menghindari shell ter-scroll saat sheet buka).
  - [ ] **A2 PWA installable** — `vite-plugin-pwa` (manifest + service worker cache app-shell/basemap).
  - ✅ **B1 Infra COG SELESAI** (migrasi applied ke DB live + RLS verified): bucket Storage
    `rasters` (public-read, tulis admin via policy storage.objects) + tabel `raster_layers`
    (admin-write/member-read, anon revoked) + lib `@geomatico/maplibre-cog-protocol`
    (protokol `cog://` registered di MapView). Store kind `raster` + `addRasterLayer`/
    `updateRasterOpacity`; `rasterLayers.ts` (list/insert/delete + `rasterPublicUrl`);
    section "Raster (COG)" di LayersTab; legend gradient. Verified store→UI (Layer Aktif +
    legend COG) & RLS DB (member baca global, non-admin insert 42501, anon 42501).
    Catatan: paint on-map tak bisa diverifikasi di env ini (render loop MapLibre berhenti
    saat Browser pane tak ditampilkan) — akan tereksekusi nyata di B2 saat COG diunggah.
  - [ ] **C1 Hujan & suhu** — fetcher Open-Meteo/NASA POWER per centroid blok → `eo_readings`.
  - [ ] **B2 Upload GeoTIFF** — mode "Raster (COG)" di UploadTab (validasi COG, unggah Storage).
  - [ ] **C2 Tanah (SoilGrids)** · **C3 DEM+drainase (TWI/HAND)** · **C4 NDVI (STAC Sentinel-2)**.


- [ ] **#3 RBAC admin vs user (produksi)** — lihat [AUDIT_RBAC.md](AUDIT_RBAC.md).
  Keputusan: Edge Function utk buat user · shell kondisional · auto-assign Demo ke `user`.
  - ✅ **Fase 1 SELESAI** (applied ke DB live + verified): `project_members` + `is_admin()`/
    `is_member()`; harden `import_project_blocks`/`create_project`/`set_project_public` (admin);
    `blocks_geojson`/`block_summary`/`block_timeseries`/`list_projects` member-scoped; RLS
    blocks/vector_layers/projects (write admin, read member); revoke anon; share publik
    dipertahankan via helper `_blocks_fc`/`_block_summary` (enforce flag); user→Demo.
  - ✅ **Fase 2 SELESAI** (verified 2 role via preview): `web/src/auth.tsx` (context
    `useIsAdmin`/`useAuth` + `fetchMyRole` dari public.users). User = read-only:
    disembunyikan ✎ simbologi, add/hapus/reorder layer, Available Layers, Run Analysis,
    Upload tab, project new/share. Tetap bisa: lihat layer, toggle visibility, basemap/3D/inset.
  - ✅ **Fase 3 SELESAI** (verified 2 role): shell kondisional — admin dapat LeftPanel
    (layer workspace penuh); user dapat `UserPanel` (info project + legenda + menu
    **Input Lapangan** stub 5 form + note read-only). Peta/bottom-panel/header dibagi.
  - ✅ **Fase 4 (inti) SELESAI**: DB policy admin read/update `users`; `web/src/admin.ts`
    + `AdminUsers` modal (set role, assign/cabut akses project per-user via checkbox,
    buat/hapus akun). Tombol ⚙ User di header (admin only). Terverifikasi DB (admin set
    role & member; user ditolak) + UI. **Edge Function `admin-users` ✅ DI-DEPLOY**
    (buat/hapus akun, guard admin verified: non-admin ditolak 401). Buat/hapus akun
    dari web app kini berfungsi. CLI mesin ini sudah login+link ke project.
  - ✅ **Fase 5**: verifikasi admin vs user via preview (semua fase).

- [ ] **#3 Role gating user vs admin** — *(HOLD atas permintaan user)*
  User = view-only; Admin = full (upload, edit simbologi, kelola project). Saat ini
  keduanya disamakan (`canUpload = any session`). Terapkan setelah #4 (project roles).

---

## 🟠 Backlog teknis (dari sesi sebelumnya)

- [ ] **Pipeline GEE — RUN** (butuh kredensial): jembatan sudah siap (`run_gee.py`,
  `utils/supabase_blocks.load_project_blocks`, `pipeline.run_phase1(blocks_gdf=…)`,
  aset katalog di `GEE_DATASETS.md`). Tinggal `pip install earthengine-api` + service
  account (pilih "Data aplikasi") lalu `python run_gee.py --project <uuid> --start … --end …`
  → NDVI/LST/hujan asli (di-mask batas blok project) ke Supabase.
- [ ] **Render raster GEE** di peta (kini GEE hanya list/legend — butuh tile pipeline).
- [ ] **Loading skeleton** (Error Boundary ✅ selesai).
- [ ] **CI GitHub Actions** (lint + test tiap push).
- [ ] 🔴 **Rotasi kredensial** yang sempat bocor: DB password `pakuntungpeduli123` +
  service_role/secret key. Setelah rotasi: update `.env`, `web/.env.local`,
  `web/src/config.ts`, env Netlify.

---

## ✅ Selesai (riwayat ringkas)

- [x] **Startup tanpa inset** — `insetsEnabled` default `false`; peta tampil penuh saat
  buka (inset dinyalakan via tombol ▣). Terverifikasi.
- [x] **Error Boundary** — `ErrorBoundary` membungkus App (main.tsx); fallback + reload.
- [x] **Jembatan GEE ↔ Supabase** — `utils/supabase_blocks.load_project_blocks` (baca
  batas blok project, terverifikasi live 12 blok), `run_gee.py` (orchestrator per project),
  `pipeline.run_phase1(blocks_gdf=…)`, `GEE_DATASETS.md` (aset katalog global di-mask
  boundary blok). Run penuh butuh `earthengine-api` + service account.
- [x] **#5 3D view** — MapLibre terrain (DEM terrarium) + sky + pitch; blok jadi
  **fill-extrusion** dengan tinggi = severity (z-index data-driven); toggle 2D/3D di
  MapTools. Layer & basemap mengikuti elevation. Terverifikasi visual.
- [x] **#2 SHP boundary → blok produksi per project** — RPC `import_project_blocks`
  (parse GeoJSON→blocks, area PostGIS, block_id prefix project = unik), geom dilonggarkan
  ke Geometry. UploadTab mode "Batas blok project" vs "Layer referensi". Lepas dari seed
  demo. Terverifikasi end-to-end di DB. (Follow-up: composite PK (project_id, block_id).)
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

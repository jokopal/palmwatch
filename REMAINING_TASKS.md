# PalmWatch — Remaining Tasks

> File pelacak task hidup. **Diperbarui tiap ada task baru; item dihapus/dipindah ke
> "Selesai" saat rampung.** Sumber kebenaran prioritas pengembangan.
> Terakhir diperbarui: 2026-08-06.

---

## 🔵 Sedang dikerjakan

- _(kosong — pilih item berikutnya dari Todo)_

---

## 🩹 Perbaikan 2026-08-06 (audit kode menyeluruh)

Enam cacat ditemukan lewat pembacaan kode + introspeksi DB live, semuanya sudah
diperbaiki & diverifikasi:

- ✅ **Loop analitik tersambung kembali** — `run_overlay.py` (BARU): overlay engine
  KEYLESS `eo_readings` → `block_conditions`. Sebelumnya `block_conditions` hanya
  bisa diisi pipeline GEE/seed, sehingga blok hasil import SHP selamanya tampil
  'normal' tanpa kondisi/intervensi. Memakai ulang `overlay.py` (threshold
  berliteratur + matriks intervensi + composite score), agregasi lintas source,
  carry-forward variabel lambat, dan **gate regresi** (yield hanya diisi bila
  R²≥0,40 & p<0,05, ≥12 periode — selain itu NULL + disclaimer, bukan angka
  karangan). 14 tes baru (`tests/test_overlay_keyless.py`). **Sudah dijalankan
  ke DB live**: 144 baris kondisi nyata (12 blok × 12 periode 2024).
  Catatan: pakai `--exclude-source Sentinel-2` agar NDVI seed sintetis tidak
  tercampur dengan NDVI asli `sentinel-2-stac`.
- ✅ **Reference layer bisa dipakai analisis lagi** — `listReferenceLayers`
  membaca payload camelCase padahal RPC mengembalikan snake_case, sehingga SEMUA
  metadata jadi `undefined`, layer turun pangkat jadi kind `db`, dan tombol
  **Run Analysis** tak pernah bisa aktif. Diperbaiki di `web/src/analysisApi.ts`.
- ✅ **Agregasi EO lintas source** — migrasi `20260711000000_eo_aggregate.sql`:
  `_blocks_fc` kini mengambil nilai terbaru non-null **per variabel**, bukan satu
  baris terbaru. Sebelumnya NDVI selalu NULL di peta/tabel/share karena baris
  open-meteo (bulanan) menimpa baris sentinel-2 (kuartalan). Verified: 12/12 blok
  kini punya `ndvi_value`. Sekaligus mengekspos `temp_2m_mean`, tekstur tanah,
  `eo_last_obs`, dan `eo_sources` (provenance) ke UI.
- ✅ **Panel detail blok hidup** — `BlockPanel.tsx` selama ini **dead code** (tak
  diimpor dari mana pun), sehingga hasil SoilGrids/C2 tak pernah terlihat.
  Ditulis ulang & dipasang: float di atas peta (desktop) + di dalam sheet
  Analisis (mobile), lengkap dengan provenance data, label kondisi berbahasa
  lapangan, intervensi + lag effect, proyeksi yield ber-gate, dan tren temporal.
- ✅ **Sisa lubang RBAC ditutup** — migrasi `20260712000000_rbac_phase1c.sql`.
  AUDIT_RBAC C.4 mewajibkan semua DEFINER RPC dihardening, tapi RPC dari
  `20260708000000_layer_management.sql` terlewat total (timestamp-nya lebih baru
  dari migrasi RBAC). Kini: `run_layer_analysis`/`save_analysis_result`/
  `upsert_production_data` = admin-only; `list_reference_layers`/
  `list_temporal_layers`/`list_analysis_results` = member-scoped + anon dicabut;
  RLS `production_data`/`analysis_results` tidak lagi `using (true)` untuk anon.
  **Catatan penting**: `revoke ... from anon` saja tidak cukup — `CREATE FUNCTION`
  memberi EXECUTE ke role `PUBLIC` dan anon mewarisinya; harus `revoke from
  public, anon`. Verified 15/15 probe (anon/user/admin) + idempoten.
- ✅ **`upsert_production_data` benar-benar upsert** — dulu `on conflict do
  nothing` tanpa constraint unik apa pun, jadi cabang UPDATE tak pernah jalan dan
  tiap unggah Excel menumpuk duplikat. Ditambah `unique (project_id, name)`.
- ✅ **Repo bersih kelas-F (ruff)** — 31 impor/variabel mati dibuang, sehingga
  step `ruff check api/ tests/` di CI yang sudah ada lebih bermakna. (Sisa ~180
  pelanggaran GAYA di modul pipeline root — UP/I/N — belum disentuh.)
  Catatan: CI GitHub Actions **sudah ada sejak lama** (`ci.yml`, `deploy.yml`,
  `keepalive.yml`); item backlog "CI GitHub Actions" di bawah sebenarnya sudah
  rampung, bukan pekerjaan baru.
- ✅ **Loading skeleton** — `LoadingOverlay.tsx`; peta tak lagi tampil kosong
  tanpa penjelasan selagi `blocks_geojson` dimuat.

## 🩹 Perbaikan render & simbologi (keluhan: layer tak terlihat, simbologi, apply)

- ✅ **Urutan tumpukan ditegakkan** — `web/src/map/layerIds.ts` (BARU).
  `syncOverlayLayers`/`syncRasterLayers` memanggil `addLayer` tanpa `beforeId`,
  jadi urutan peta = urutan penambahan: layer baru selalu menimpa yang lama dan
  tombol ↑↓ **tidak berefek apa pun**. Kini store memakai konvensi QGIS
  (indeks 0 = paling atas, layer baru masuk di atas) dan MapView menegakkannya
  ke MapLibre lewat `moveLayer`. Raster COG dipaksa selalu di bawah seluruh
  vektor — satu DEM full-extent dulu menutupi semua poligon.
- ✅ **Reference layer akhirnya berwarna per kelas** — `defaultReferenceSymbology`
  tak pernah mengisi `categoryField`, sehingga `fillColorExpr` jatuh ke warna
  tunggal: SEMUA reference layer tampil hijau polos dan editor kategori
  tersembunyi. Kini `categoryField` diturunkan dari field diagnostik, dan
  `updateReferenceConfig` meregenerasi kategori tiap kelas/field berubah
  (dulu hasil "Auto-detect" tak pernah sampai ke peta).
- ✅ **Panel properti jadi live** — draft lokal + tombol "Apply" dibuang; tiap
  ubahan langsung ke store sehingga peta berubah seketika. Yang tersisa hanya
  "Simpan konfigurasi ke DB" (satu-satunya aksi yang menulis ke database).
- ✅ **Kontrol raster ada di panel** — opacity/skema warna/rentang nilai kini
  bisa diubah setelah layer aktif (`updateRasterConfig`); MapView membangun
  ulang source saat colormap/rentang berubah karena nilainya tertanam di URL
  `cog://`. Sebelumnya slider opacity di panel tak menyentuh `rasterConfig`
  sama sekali — persis keluhan "apply tidak berpengaruh".
- ✅ **Raster di luar AOI tidak lagi hilang diam-diam** — `clipRasterToBoundary`
  default ON + `setMask` global membuat COG yang tak bersinggungan dengan batas
  blok terpotong habis. Kini bbox dicek dulu; bila tak bersinggungan masking
  dilewati dan alasannya muncul sebagai badge di daftar layer.
- ✅ **Kegagalan layer terlihat** — state `layerErrors` diisi dari event `error`
  MapLibre (COG rusak/404/CORS) dan ditampilkan sebagai badge "gagal" + pesan di
  panel properti. Layer GEE diberi badge "tak dirender" (memang belum ada
  pipeline tile) alih-alih membiarkan pengguna menunggu sesuatu yang tak akan
  muncul.
- ✅ **Performa & korektness render** — `setData()` hanya dipanggil bila GeoJSON
  benar-benar berganti (dulu tiap emit store, jadi menggeser slider mem-parse
  ulang seluruh FeatureCollection); rekonsiliasi memakai ref, bukan
  `map.getStyle()`; handler klik blok didaftarkan sekali (dulu menumpuk tiap
  layer blok dimatikan/dihidupkan).
- ✅ **Regresi "tanpa layer default" ditutup** — sejak `activeLayers` mulai
  kosong, tampilan **share publik** dan role **user** (yang tak punya manajer
  layer) hanya menampilkan basemap kosong. Keduanya kini mengaktifkan layer
  blok otomatis; admin tetap mulai dari kanvas bersih. Layer blok juga kini
  bisa dilepas kembali (dulu `removeLayer` menolaknya → tombol "+ ADD" terkunci
  selamanya).

> Catatan verifikasi: paint MapLibre tak bisa diuji di environment agent (render
> loop berhenti saat Browser pane tak ditampilkan). Yang diverifikasi langsung
> di browser: seluruh logika store + fungsi urutan (`__layerOrder` debug hook),
> termasuk uji anti-loop emit. Tampilan akhir perlu dicek mata di browser Anda.

---

### ⚠️ Temuan yang WAJIB diketahui sesi berikutnya

**DB live pernah menyimpang jauh dari folder migrasi.** Introspeksi 2026-08-06
menemukan `20260708000000_layer_management.sql` **tidak pernah diterapkan**:
tabel `production_data`/`analysis_results` tidak ada, `vector_layers` tak punya
kolom `layer_role`/`diagnostic_field`/`layer_config`, dan seluruh RPC layer
management (`run_layer_analysis`, `save_analysis_result`, `list_reference_layers`,
…) tidak ada. Artinya fitur "Layer Management System" (commit `aacb685`) selama
berbulan-bulan hanya hidup di kode. Sudah diterapkan sekarang.
→ **Jangan percaya folder migrasi sebagai gambaran DB live. Introspeksi dulu.**

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
  - ✅ **A2 PWA installable SELESAI** — `vite-plugin-pwa` (autoUpdate): manifest (ikon brand
    192/512 + maskable, theme #14361F, standalone, id), service worker precache app-shell
    (23 entri ~2.8MB, batas dinaikkan utk bundle 2.1MB) + runtimeCaching offline: basemap
    tiles (Carto/OSM/OpenTopo/ArcGIS CacheFirst 30h), glyph MapLibre, Google Fonts. SW aktif
    di build (HTTPS Netlify) — bukan dev. Verified: build artefak (manifest/sw.js/registerSW).
  - ✅ **B1 Infra COG SELESAI** (migrasi applied ke DB live + RLS verified): bucket Storage
    `rasters` (public-read, tulis admin via policy storage.objects) + tabel `raster_layers`
    (admin-write/member-read, anon revoked) + lib `@geomatico/maplibre-cog-protocol`
    (protokol `cog://` registered di MapView). Store kind `raster` + `addRasterLayer`/
    `updateRasterOpacity`; `rasterLayers.ts` (list/insert/delete + `rasterPublicUrl`);
    section "Raster (COG)" di LayersTab; legend gradient. Verified store→UI (Layer Aktif +
    legend COG) & RLS DB (member baca global, non-admin insert 42501, anon 42501).
    Catatan: paint on-map tak bisa diverifikasi di env ini (render loop MapLibre berhenti
    saat Browser pane tak ditampilkan) — akan tereksekusi nyata di B2 saat COG diunggah.
  - ✅ **C1 Hujan & suhu SELESAI + DIJALANKAN** (data nyata di DB live): `run_climate.py`
    (Open-Meteo Archive, tanpa key) query per-CENTROID blok (clip AOI) → `eo_readings`
    (rainfall_30d/90d + kolom baru `temp_2m_mean`), source='open-meteo'. 144 baris real
    2024 utk Demo (12 blok × 12 bln; hujan 160–413mm/30h, suhu 26–28°C). Migrasi
    `20260710000000` + `block_timeseries` diperluas multi-variabel (member-scoped).
  - ✅ **Temporal dataset option SELESAI** — panel Temporal (footer) mode **Dataset EO**:
    selector variabel (hujan/suhu/NDVI/EVI/LAI/soil/ET/TBS) + LineChart per blok terpilih;
    mode **Layer Referensi** dipertahankan. Verified UI + RPC (BLK-001 15 titik authenticated).
  - ✅ **C2 Tanah (SoilGrids) SELESAI** — `run_soil.py` (SoilGrids v2.0 ISRIC, keyless,
    per-centroid clip AOI, throttle 13s) → `soil_properties` (pH/SOC/clay/sand/CEC/N).
    Auto-tampil di BlockPanel (soil_ph/soc sudah di-LEFT JOIN `blocks_geojson`).
  - ✅ **C4 NDVI (STAC Sentinel-2) SELESAI + DIJALANKAN** — `run_ndvi.py` (Planetary
    Computer STAC keyless; scene termurah-awan per kuartal; baca B04/B08 HANYA jendela
    tiap blok via rasterio.mask = clip AOI/range-request; NDVI zonal + offset BOA -1000)
    → `eo_readings.ndvi_mean`. 48 baris real 2024 (NDVI 0.05–0.61), source='sentinel-2-stac'.
  - ✅ **Opsi clip raster ke boundary SELESAI** — store `clipRasterToBoundary` (default on) +
    tombol ✂ di MapTools; MapView pakai `setMask(blocks FC)` (global lib) → render raster
    di-clip ke batas blok (fokus AOI, lebih ringan); rebuild source saat toggle berubah.
  - ⏸ **C3 DEM+drainase** — `run_dem.py` SELESAI & TERUJI generate (Copernicus GLO-30 keyless,
    clip AOI bbox, turunkan slope=proxy drainase, tulis COG kecil ~200KB). **Unggah ke
    Storage TERBLOKIR**: butuh `SUPABASE_SERVICE_KEY` di `.env` (belum ada) ATAU unggah via
    tab Upload (B2). Set key → run_dem.py auto-upload+register ke `raster_layers`.
  - ✅ **B2 Upload GeoTIFF SELESAI** — mode "Raster (COG GeoTIFF)" di UploadTab: pilih .tif,
    kategori + skema warna + min/max, `uploadRasterCog` (rasterLayers.ts) unggah ke bucket
    `rasters` via sesi ADMIN (RLS admin-write, **tanpa service key**), validasi COG via
    `getCogMetadata` (ambil bbox; hapus file bila bukan COG), catat ke `raster_layers`.
    **Ini membuka jalur unggah C3**: admin tinggal unggah `out_cog/dem.tif`/`slope.tif`.
    Verified UI (mode+field+submit) + typecheck/build. Upload nyata butuh sesi admin login.


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
- [x] ~~Loading skeleton~~ — selesai 2026-08-06 (`LoadingOverlay.tsx`).
- [x] ~~CI GitHub Actions~~ — ternyata sudah ada sejak lama di
  `.github/workflows/` (ci + deploy + keepalive); item ini basi, bukan pekerjaan
  tertunda.
- [ ] 🔴 **Rotasi kredensial** yang sempat bocor: DB password `pakuntungpeduli123` +
  service_role/secret key. Setelah rotasi: update `.env`, `web/.env.local`,
  `web/src/config.ts`, env Netlify. **Hanya bisa dikerjakan pemilik project.**
- [ ] **Bersihkan data seed sintetis** di `eo_readings` (`source='Sentinel-2'`,
  36 baris) agar tidak tercampur observasi nyata. Sementara ini disiasati lewat
  `run_overlay.py --exclude-source Sentinel-2`.
- [ ] **Backlog gaya ruff** (~180 UP/I/N/E) — non-blocking di CI; kikis bertahap.
- [ ] **Verifikasi visual BlockPanel** perlu sesi login (admin/user). Jalur share
  publik sudah terverifikasi di browser (12 blok, 7 kritis, 0 error konsol).
- [ ] **Drainase belum pernah memicu intervensi**: aturan `high_twi`/`high_slope`
  butuh kolom `twi_approx`/`slope_deg` yang belum ada di `eo_readings`. Slope
  sudah dihitung `run_dem.py` sebagai raster — perlu zonal-stats ke tabel agar
  intervensi drainase (Paramananthan 2000) bisa aktif.

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

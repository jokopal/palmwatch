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

## 🚦 Fase A — Pagar role & pembekuan fitur (SELESAI)

- ✅ **`web/src/capabilities.ts`** — satu sumber kebenaran "siapa boleh apa".
  Dulu keputusan ini tersebar sebagai `isAdmin &&` di belasan tempat; satu titik
  terlewat = kontrol admin bocor ke viewer. Komponen kini memakai
  `useCapabilities()`, tidak pernah memeriksa role langsung.
- ✅ **Role `loading` eksplisit** — selama role belum diketahui, kapabilitasnya
  kosong. Sebelumnya default `"user"` membuat UI viewer berkedip untuk admin.
- ✅ **`fetchMyRole()` bertipe hasil** — kegagalan (RLS/jaringan/baris hilang)
  tidak lagi tak bisa dibedakan dari "memang viewer". Gagal = role `guest`
  (paling terbatas) + banner yang menyebut sebabnya.
- ✅ **Bypass auth dikunci ke dev** — `VITE_PREVIEW_NO_AUTH` kini dibungkus
  `import.meta.env.DEV`, jadi cabangnya hilang dari bundel produksi. Nilai
  role preview wajib eksplisit; dulu apa pun selain `"user"` berarti **admin
  tanpa login**.
- ✅ **`web/src/features.ts`** — flag `ready | locked | hidden`. Terkunci
  sekarang: analysis, tab Temporal, tab Conclusion, inset, production data,
  unggah raster. Tersembunyi: layer GEE (tak punya pipeline tile sama sekali).
  Membuka fitur = ubah satu baris di berkas itu.

## 🖼️ Fase B — Raster dijamin tampil (SELESAI)

COG diganti **overlay PNG + `image` source MapLibre**. Alasannya: seluruh raster
proyek ini hanya ~112.000 piksel (setara satu citra 334×334); men-decode GeoTIFF
di browser adalah overhead yang justru jadi sumber kegagalan senyap. Dua bug
nyata ditemukan di jalur lama: 7 dari 8 nama colormap di `defaultCogs.json`
tidak dikenal library, dan URL-nya relatif.

- ✅ **`scripts/build_raster_overlays.py`** — baca raster (dari `raster_layers`
  atau `web/public/cogs`), warnai dengan matplotlib, tulis PNG ber-alpha
  (nodata transparan) + manifest `web/src/rasterOverlays.json` berisi bbox,
  rentang nilai, dan warna legenda. Membuang PNG basi yang tak ada di manifest.
  Raster < 12 piksel dilewati (Curah Hujan 2×1 px bukan peta, itu satu angka).
- ✅ **17 overlay, total 74,9 KB** — lebih kecil dari TIFF sumbernya (204 KB).
- ✅ **Legenda dijamin cocok dengan gambar** — gradiennya dibangun dari colormap
  yang sama. Dulu hardcoded biru-hijau apa pun skema rasternya.
- ✅ Dibuang: `cogProtocol`, `setMask`/`clearMask`, `clipRasterToBoundary`,
  tombol ✂, `defaultCogs.json`, `web/public/cogs/`, fallback blob COG di upload.

> **Konsekuensi yang disengaja:** warna raster jadi tetap. Ganti skema warna
> atau rentang = jalankan ulang skripnya, bukan geser kontrol di panel. Nilai
> piksel juga tak bisa dibaca saat hover. Raster yang baru diunggah belum
> tampil sampai skrip dijalankan — karena itu unggah raster dikunci.

---

## 🎛️ Panel layer untuk anggota & simbologi dari data (SELESAI)

Tiga perbaikan setelah tinjauan tampilan role `user`.

**1. Anggota tidak melihat daftar layer aktif — bug dari saya sendiri.**
`.user-panel` dan `.left-panel` sama-sama memasang `height: 100%`. Saat saya
menumpuk keduanya di `.right-stack` dengan `flex-shrink: 0`, UserPanel memakan
seluruh tinggi kolom dan manajer layer terdorong keluar layar. Menumpuk dua
komponen yang sama-sama merasa memiliki seluruh kolom memang salah — kini
keduanya jadi **tab**: `Layer` dan `Info Kebun`.

Aksi yang didapat anggota per layer: zoom `⛶`, edit simbologi `✎`, naik/turun
`▲▼`, dan centang visibilitas. Yang tidak ada: tombol hapus, tombol kunci,
katalog Available Layers, tab Upload, dan tombol Publikasikan.

**2. Nama layer masih nama demo.** `"Harvest Blocks"` → konstanta
`BLOCKS_LAYER_NAME = "Batas Blok Kebun"`. Sisa seed demo berbahasa Inggris pada
data kebun sungguhan.

**3. Simbologi & legenda tidak berasal dari data.**

- `blocksData` kini disimpan di store. Sebelumnya layer blok tak punya `.data`,
  sehingga panel properti memakai daftar field **statis** dan legenda
  di-hardcode ke empat tingkat `priority_level`.
- Mengganti field kategori kini **menurunkan ulang kelasnya dari data**
  (`detectClasses`). Dulu hanya `categoryField` yang berubah sementara kategori
  lama tetap terpasang, jadi ekspresi warna mencocokkan nilai yang tak pernah
  ada dan semua fitur jatuh ke warna fallback — persis rasa "simbologi tidak
  berdasarkan data".
- Pemilih field kini selalu tampil. Dulu ia hanya muncul dalam mode
  `categorized`, sedangkan mode itu baru bisa dipilih kalau kategori sudah ada:
  jalan buntu tanpa pintu masuk.
- Legenda diturunkan dari simbologi yang sedang aktif dan dihitung dari data,
  serta **menyembunyikan kelas ber-nilai nol**. Terbukti: diklasifikasi menurut
  `variety` → "Tenera 3 / Dura 2"; dikembalikan ke `priority_level` yang kosong
  → hanya "Belum ada data 5", empat baris nol itu hilang.

> Verifikasi tampilan role: `.claude/launch.json` punya konfigurasi
> **web-as-user** (port 5174, `--mode preview`). Butuh `web/.env.preview`
> (gitignored) berisi `VITE_PREVIEW_NO_AUTH=1`, `VITE_PREVIEW_ROLE=user|admin`,
> plus salinan kredensial dari `web/.env.local`. Hanya berlaku di dev —
> `import.meta.env.DEV` menghapus cabangnya dari bundel produksi.

---

## 📢 Publikasi layer & akses per project (SELESAI)

Migrasi `20260717000000_published_layer_view.sql` + `web/src/publishedLayers.ts`.

**Masalah:** susunan layer aktif hanya hidup di memori browser admin. Tidak ada
apa pun di database yang menyatakan "inilah yang saya ingin anggota project
lihat", sehingga anggota hanya melihat batas blok.

- ✅ Tabel `project_layer_views` — satu susunan terpublikasi per project
  (urutan, simbologi, visibilitas). **GeoJSON tidak disimpan**, hanya
  `source_ref`: satu layer garis di project ini saja 9 MB.
- ✅ RPC `publish_project_layers` (admin saja, ditegakkan di dalam fungsi) dan
  `get_project_layers` (anggota project). RLS: baca anggota, tulis admin.
- ✅ Tombol **"📢 Publikasikan N layer ke user"** di header Layer Aktif.
- ✅ `LeftPanel` punya dua jalur: admin memuat katalog DB; anggota memulihkan
  susunan terpublikasi lalu menarik geojson per layer.

**Kapabilitas dipecah** — `editLayers` dulu mengendalikan dua hal berbeda:

| | admin | user |
|---|---|---|
| `styleLayers` — simbologi, urutan, nyala/mati | ✅ | ✅ |
| `manageLayerSet` — tambah/hapus layer, katalog, kunci | ✅ | ❌ |
| `publishLayers`, `uploadData`, `saveLayerConfig` | ✅ | ❌ |

Anggota tidak boleh menghapus layer: mereka tidak punya katalog untuk
menambahkannya kembali. Tab Upload kini disembunyikan sepenuhnya bagi mereka
(dulu hanya dinonaktifkan — tab yang selamanya mati).

**Manajemen user:** kolom checkbox per project diganti daftar chip akses +
dropdown "beri akses". Dulu satu kolom per project — dengan satu project tampak
seolah aplikasi hanya mengenal satu kebun, dengan sepuluh project tabelnya
melebar sampai tak terbaca. Role admin ditandai "Semua project" karena
`is_member()` memang selalu meloloskannya.

Verifikasi (menyamar sebagai tiap role lewat klaim JWT): admin memublikasikan 2
layer → anggota membacanya utuh → user mencoba memublikasikan **ditolak**
(`Hanya admin yang boleh memublikasikan susunan layer`) → non-anggota membaca
project lain dapat `NULL`.

---

## 📊 Fase D — Empty state jujur & poles preview (SELESAI)

Migrasi `20260716000000_phase_d_no_data_state.sql`:

- ✅ **"Belum ada data" ≠ "Sehat".** `coalesce(c.priority_level,'normal')`
  membuat blok yang belum pernah dianalisis terhitung sehat — header
  menampilkan "5 sehat" untuk kebun yang belum diperiksa sama sekali. Kini
  `priority_level` NULL bila tak ada kondisi, ditambah flag `has_conditions`,
  dan summary punya ember `no_data` + `n_analyzed` terpisah.
- ✅ `mean_regression_r2` jadi NULL, bukan 0 — rata-rata himpunan kosong
  bukanlah nol.
- ✅ `tenant_id` yang di-hardcode `'demo'` diganti nama project sebenarnya.
- ✅ **Filter `priority=no_data`** untuk menyaring blok yang belum dianalisis.

Sisi tampilan:

- ✅ Palet & label: `no_data` → abu netral `#94A3B8`, "Belum ada data".
  Helper `priorityColor()` / `priorityLabel()` menerima null sehingga tidak ada
  lagi tempat yang bisa lupa menanganinya.
- ✅ **`fillColorExpr` memakai `coalesce`** — MapLibre `match` tidak bisa
  mencocokkan null, jadi blok tanpa data dulu jatuh ke warna fallback hijau
  tua alias tampak sehat. Sekarang abu.
- ✅ Header, share view, UserPanel, dan panel detail blok memakai keadaan
  "belum dianalisis" alih-alih angka yang menyesatkan.

Perbaikan yang ditemukan saat mengerjakan fase ini:

- ✅ **Share publik tidak pernah menampilkan layer.** `shared_project` hanya
  mengembalikan project/summary/blok, lalu frontend jatuh ke kueri tabel
  langsung yang selalu ditolak (401) karena pengunjung tidak login. RPC kini
  menyertakan daftar layer, dan fallback kueri tabel dibuang.
- ✅ **Payload share 15 MB → 14 KB.** Percobaan pertama menyematkan seluruh
  geojson dan membuat halaman menggantung (satu layer garis 9 MB, dua layer
  titik 12.359 fitur). Kini `shared_project` mengirim metadata + jumlah fitur,
  dan `shared_layer_geojson(token, layer_id)` mengambil per layer — token
  divalidasi ulang di sana agar satu token tidak membuka layer project lain.
  Layer ≤ 2.000 fitur dimuat otomatis, sisanya lewat tombol **Muat**.
- ✅ **Duplikat layer.** Penjaga anti-duplikat di `addDbLayer` menuntut
  `kind === "db"`, padahal reference layer ber-kind `"reference"` — memanggilnya
  dua kali menambahkan layer yang sama dua kali.
- ✅ **`setLayerVisible` / `setLayerLocked` idempoten.** Alur setup memakai
  `toggleLayerVisible`; effect React yang berjalan dua kali membalik nilainya
  kembali, sehingga 17 raster yang seharusnya mati justru menyala menumpuk.

---

## 🧹 Fase C — Data nyata, demo dibuang (SELESAI)

Backup penuh dibuat lebih dulu: `python scripts/backup_db.py --label sebelum-hapus-demo`
→ `backups/20260817-041413-sebelum-hapus-demo/` (428 baris, 12 tabel, CSV +
`restore.sql` dengan geometri EWKT). Folder `backups/` masuk `.gitignore`.

Migrasi `20260715000000_phase_c_real_data.sql`:

- ✅ **Project diganti nama** → `Kebun 77 - Kotawaringin` (dari
  "Kalimantan Timur — Demo"). Namanya ada di DB, bukan hardcode di frontend.
- ✅ **Estate blok nyata disamakan** — sebelumnya mewarisi nama project lama.
- ✅ **12 blok demo `BLK-*` dihapus permanen**, beserta 144 kondisi, 228
  pembacaan EO, dan 12 data tanah (FK `ON DELETE CASCADE`). Blok-blok itu ada
  di Kalimantan Timur (~117,15 BT), 610 km dari kebun sebenarnya, sehingga
  `fitBounds` selalu merentang lintas pulau. **Rentang peta kini 1,6 km.**
- ✅ **Layer uji `C_1` dihapus** — 63 poligon di Lombok–Sumbawa (116,0 BT /
  −8,9 LS), atribut serba "Tidak Ada", dan `project_id`-nya NULL.
- ✅ **Kebocoran RLS ditutup** — tiga kebijakan baca (`vector_layers`,
  `raster_layers`, `analysis_results`) memberi akses ke baris ber-`project_id`
  NULL kepada SEMUA user terautentikasi. Dengan satu project tak terasa; begitu
  ada kebun kedua, data satu klien terlihat oleh klien lain. Admin tetap bisa
  melihat baris yatim lewat `is_admin()` di dalam `is_member()`.

Pembersihan jalur data palsu di kode:

- ✅ **`supabase/seed.sql` + `scripts/generate_seed.py` + `load_seed.py` dihapus.**
  Berkas seed sudah diperbarui ke nama/koordinat asli, tapi baris pertamanya
  `truncate ... cascade` — menjalankannya sekarang akan **menghapus 5 blok
  nyata** lalu menggantinya dengan blok sintetis. Itu ranjau, bukan alat.
- ✅ **`api/sample_data.py` dihapus**, fallback di `data_source.py` dicabut.
  Dulu endpoint diam-diam menyajikan blok karangan saat PostGIS mati sehingga
  dashboard tampak sehat; kini melempar `DataUnavailable` → HTTP 503.
- ✅ **`tests/test_api.py` ditulis ulang** (10 tes → 7). Tes lama justru
  mengunci perilaku lama: memastikan data karangan selalu tersaji.
- ✅ Dokumen (`supabase/SETUP.md`, `web/README.md`, `types.ts`) tak lagi
  merujuk berkas yang sudah tidak ada.

### Sisa yang perlu diputuskan

- **`blocks_example.geojson` dipertahankan** — hanya dipakai `tests/test_geometry.py`
  sebagai fixture unit test, bukan data aplikasi.
- **KPI "5 sehat" menyesatkan.** Kelima blok tidak punya data kondisi sama
  sekali, tapi `coalesce(priority_level,'normal')` membuatnya terhitung sehat.
  Ini pekerjaan Fase D (empty state jujur).
- **`is_public = true`** pada project masih aktif (link share hidup). Tinjau
  sebelum rilis ke klien.

---

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

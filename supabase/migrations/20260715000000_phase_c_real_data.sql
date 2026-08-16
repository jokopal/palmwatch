-- =====================================================================
-- Fase C — Naikkan project ke data nyata, buang data demo
--
--  1. Ganti nama project jadi "Kebun 77 - Kotawaringin"
--  2. Samakan `estate` pada blok nyata dengan nama kebun sebenarnya
--  3. HAPUS PERMANEN 12 blok demo BLK-* (Kalimantan Timur, seed) beserta
--     seluruh turunannya lewat FK ON DELETE CASCADE
--  4. Hapus layer uji nyasar "C_1" (Nusa Tenggara, ~800 km dari kebun)
--  5. Tutup kebocoran RLS: baris ber-project_id NULL tak lagi terbaca semua user
--
-- BERSIFAT MERUSAK. Backup penuh dibuat lebih dulu dengan
-- `python scripts/backup_db.py --label sebelum-hapus-demo`.
--
-- Idempoten: aman dijalankan ulang.
-- =====================================================================

begin;

-- ── 1. Nama project ──────────────────────────────────────────────────────────
-- Nama lama "Kalimantan Timur — Demo" berasal dari seed awal dan tampil di
-- header aplikasi serta halaman share publik.
update public.projects
   set name        = 'Kebun 77 - Kotawaringin',
       estate      = 'Kebun 77 - Kotawaringin',
       description = 'Kebun sawit Kotawaringin — data produksi nyata'
 where id = '00000000-0000-0000-0000-000000000001';

-- ── 2. Estate pada blok nyata ────────────────────────────────────────────────
-- Blok hasil unggahan mewarisi nama project lama saat diimpor.
update public.blocks
   set estate = 'Kebun 77 - Kotawaringin'
 where block_id not like 'BLK-%';

-- ── 3. Hapus blok demo ───────────────────────────────────────────────────────
-- BLK-001..012 adalah blok sintetis di Kalimantan Timur (~117,15 BT), sekitar
-- 610 km dari kebun sebenarnya. Keberadaannya membuat fitBounds merentang
-- lintas pulau sehingga peta selalu ter-zoom-out ekstrem, dan membuat KPI
-- header mencampur angka demo dengan angka nyata.
--
-- block_conditions, eo_readings, dan soil_properties ikut terhapus lewat
-- FK ON DELETE CASCADE (masing-masing 144 / 228 / 12 baris).
delete from public.blocks where block_id like 'BLK-%';

-- ── 4. Layer uji nyasar ──────────────────────────────────────────────────────
-- "C_1" berisi 63 poligon di 116,01–116,73 BT / −8,93 LS (Lombok–Sumbawa),
-- dengan atribut serba "Tidak Ada". Bukan bagian dari kebun ini, dan karena
-- project_id-nya NULL ia terlihat oleh setiap user yang login.
delete from public.vector_layers where name = 'C_1' and project_id is null;

-- ── 5. Tutup kebocoran project_id NULL ───────────────────────────────────────
-- Tiga kebijakan baca memberi akses ke baris tanpa project kepada SEMUA user
-- terautentikasi. Dengan satu project hal ini tak terasa, tapi begitu ada
-- kebun kedua, data satu klien akan terlihat oleh klien lain.
--
-- is_member(NULL) tetap bernilai true untuk admin (lewat is_admin()), jadi
-- admin masih bisa melihat baris yatim untuk merapikannya.
drop policy if exists vlayers_member_read on public.vector_layers;
create policy vlayers_member_read on public.vector_layers
  for select to authenticated
  using (public.is_member(project_id));

drop policy if exists raster_member_read on public.raster_layers;
create policy raster_member_read on public.raster_layers
  for select to authenticated
  using (public.is_member(project_id));

drop policy if exists ar_member_read on public.analysis_results;
create policy ar_member_read on public.analysis_results
  for select to authenticated
  using (public.is_member(project_id));

commit;

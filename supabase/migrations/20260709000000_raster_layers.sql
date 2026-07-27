-- PalmWatch — Raster COG mandiri (Track B, B1)
-- =====================================================================
-- Menyimpan raster (DEM, jenis tanah, TWI, dll.) sebagai Cloud-Optimized
-- GeoTIFF (COG) di Supabase Storage, di-render di peta via range-request
-- (maplibre-cog-protocol) — tanpa server tile, tanpa GEE.
--
-- Enforcement RBAC identik dengan vector_layers:
--   tulis = admin (is_admin), baca = member (is_member / project global null).
-- File biner di bucket 'rasters' (public-read: konten lingkungan non-sensitif;
-- tulis dibatasi admin lewat policy storage.objects). URL tak bisa ditebak
-- (uuid) & penemuannya digerbang RLS tabel raster_layers.
-- =====================================================================

-- ── 1. Bucket Storage ────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('rasters', 'rasters', true)
on conflict (id) do nothing;

-- Storage RLS: baca publik (bucket public), tulis hanya admin.
drop policy if exists rasters_public_read on storage.objects;
create policy rasters_public_read on storage.objects
  for select to public using (bucket_id = 'rasters');

drop policy if exists rasters_admin_insert on storage.objects;
create policy rasters_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'rasters' and public.is_admin());

drop policy if exists rasters_admin_update on storage.objects;
create policy rasters_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'rasters' and public.is_admin());

drop policy if exists rasters_admin_delete on storage.objects;
create policy rasters_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'rasters' and public.is_admin());

-- ── 2. Tabel metadata ────────────────────────────────────────────────
create table if not exists public.raster_layers (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references public.projects(id) on delete cascade,
  name          text not null,
  storage_path  text not null,                 -- path di dalam bucket 'rasters'
  category      text not null default 'other', -- dem | soil | rainfall | twi | ndvi | other
  bounds        jsonb,                         -- [minx,miny,maxx,maxy] EPSG:4326
  colormap      text,                          -- mis. 'viridis','terrain'; null = RGB apa adanya
  band          integer not null default 1,
  nodata        double precision,
  min_value     double precision,              -- untuk rescale colormap
  max_value     double precision,
  opacity       real not null default 1.0,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_raster_layers_project on public.raster_layers (project_id);

alter table public.raster_layers enable row level security;

drop policy if exists raster_admin_write on public.raster_layers;
create policy raster_admin_write on public.raster_layers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists raster_member_read on public.raster_layers;
create policy raster_member_read on public.raster_layers for select to authenticated
  using (project_id is null or public.is_member(project_id));

grant select on public.raster_layers to authenticated;
grant insert, update, delete on public.raster_layers to authenticated;
-- anon tak boleh menyentuh katalog raster (baca via member saja).
revoke all on public.raster_layers from anon;

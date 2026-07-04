-- PalmWatch — layer vektor hasil upload pengguna (batas kebun, dll.)
-- =====================================================================
-- Menyimpan layer GeoJSON/SHP yang diupload admin agar dapat dipanggil kembali
-- dan ditambahkan ke peta. Geometri disimpan sebagai jsonb FeatureCollection
-- (bukan kolom PostGIS) sehingga langsung siap-render di client tanpa konversi.
-- Untuk analitik spasial lanjut, kolom PostGIS dapat ditambahkan kemudian.
-- =====================================================================

create table if not exists public.vector_layers (
    id             uuid primary key default gen_random_uuid(),
    tenant_id      text not null default 'demo',
    name           text not null,
    kind           text not null default 'boundary',
    feature_count  integer not null default 0,
    geojson        jsonb not null,
    created_by     uuid references auth.users(id) on delete set null,
    created_at     timestamptz not null default now()
);
create index if not exists idx_vector_layers_tenant on public.vector_layers (tenant_id);

alter table public.vector_layers enable row level security;

-- Baca: anon & authenticated boleh melihat metadata + geojson (dashboard publik
-- dalam tenant demo). Perketat per-tenant saat multi-tenant penuh.
drop policy if exists vector_layers_read on public.vector_layers;
create policy vector_layers_read on public.vector_layers
    for select to anon, authenticated using (true);

-- Tulis: hanya pengguna terautentikasi (admin) yang boleh upload.
drop policy if exists vector_layers_insert on public.vector_layers;
create policy vector_layers_insert on public.vector_layers
    for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists vector_layers_delete on public.vector_layers;
create policy vector_layers_delete on public.vector_layers
    for delete to authenticated using (auth.uid() = created_by);

grant select on public.vector_layers to anon, authenticated;
grant insert, delete on public.vector_layers to authenticated;

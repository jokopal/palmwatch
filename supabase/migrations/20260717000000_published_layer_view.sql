-- =====================================================================
-- Susunan layer yang dipublikasikan admin
--
-- LATAR BELAKANG
-- Sampai sekarang susunan layer aktif hanya hidup di memori browser admin.
-- Tidak ada apa pun di database yang menyatakan "inilah yang saya ingin
-- anggota project lihat", sehingga user non-admin tidak punya titik awal sama
-- sekali — mereka hanya melihat batas blok.
--
-- Tabel ini menyimpan SATU susunan terpublikasi per project: urutan layer,
-- simbologi, dan visibilitas awal. GeoJSON TIDAK disimpan di sini — hanya
-- rujukan (source_ref). Isinya ditarik ulang oleh klien dari vector_layers /
-- manifest overlay, karena satu layer saja bisa 9 MB.
--
-- Idempoten: aman dijalankan ulang.
-- =====================================================================

begin;

create table if not exists public.project_layer_views (
  project_id   uuid primary key references public.projects(id) on delete cascade,
  -- Array terurut. Tiap elemen: { source_ref, kind, name, visible, symbology,
  -- reference_config?, raster_config? }. Indeks 0 = paling atas (konvensi QGIS,
  -- lihat catatan z-order di web/src/store/mapStore.ts).
  layers       jsonb not null default '[]'::jsonb,
  published_at timestamptz not null default now(),
  published_by uuid references public.users(id)
);

comment on table public.project_layer_views is
  'Susunan layer terpublikasi per project — titik awal tampilan bagi anggota non-admin.';

alter table public.project_layer_views enable row level security;

-- Baca: anggota project. Tulis: admin saja.
drop policy if exists plv_member_read on public.project_layer_views;
create policy plv_member_read on public.project_layer_views
  for select to authenticated
  using (public.is_member(project_id));

drop policy if exists plv_admin_write on public.project_layer_views;
create policy plv_admin_write on public.project_layer_views
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── publish_project_layers ───────────────────────────────────────────────────
-- Menimpa susunan terpublikasi milik project. Admin saja.
create or replace function public.publish_project_layers(p_project_id uuid, p_layers jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path to 'public'
as $function$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Hanya admin yang boleh memublikasikan susunan layer.'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_layers) <> 'array' then
    raise exception 'p_layers harus berupa array JSON.' using errcode = '22023';
  end if;

  insert into public.project_layer_views (project_id, layers, published_at, published_by)
  values (p_project_id, p_layers, now(), auth.uid())
  on conflict (project_id) do update
    set layers = excluded.layers,
        published_at = excluded.published_at,
        published_by = excluded.published_by;

  v_count := jsonb_array_length(p_layers);
  return jsonb_build_object('ok', true, 'n_layers', v_count, 'published_at', now());
end;
$function$;

-- ── get_project_layers ───────────────────────────────────────────────────────
-- Susunan terpublikasi untuk anggota project. NULL bila admin belum pernah
-- memublikasikan apa pun — klien membedakan "belum dipublikasikan" dari
-- "dipublikasikan tapi kosong".
create or replace function public.get_project_layers(p_project_id uuid)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
           'layers', v.layers,
           'published_at', v.published_at)
  from public.project_layer_views v
  where v.project_id = p_project_id
    and public.is_member(p_project_id);
$function$;

revoke all on function public.publish_project_layers(uuid, jsonb) from public, anon;
revoke all on function public.get_project_layers(uuid) from public, anon;
grant execute on function public.publish_project_layers(uuid, jsonb) to authenticated;
grant execute on function public.get_project_layers(uuid) to authenticated;

commit;

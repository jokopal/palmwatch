-- PalmWatch — Project groups + public share link (#4)
-- =====================================================================
-- Model multi-project: tiap kebun/estate adalah "project". Blok & layer vektor
-- di-scope per project. Share link publik (read-only, tanpa login) via token.
--
-- Backward-compatible: RPC blocks_geojson/block_summary diberi param project
-- ber-default NULL sehingga pemanggilan lama (tanpa project) tetap jalan.
-- =====================================================================

-- ── Tabel projects ───────────────────────────────────────────────────────────
create table if not exists public.projects (
    id           uuid primary key default gen_random_uuid(),
    name         text not null,
    description  text,
    estate       text,
    owner_id     uuid references auth.users(id) on delete set null,
    share_token  text unique not null default replace(gen_random_uuid()::text, '-', ''),
    is_public    boolean not null default false,
    created_at   timestamptz not null default now()
);

-- ── Kaitkan blok & layer ke project ─────────────────────────────────────────
alter table public.blocks        add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.vector_layers add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists idx_blocks_project  on public.blocks(project_id);
create index if not exists idx_vlayers_project on public.vector_layers(project_id);

-- ── Project default untuk data yang sudah ada ───────────────────────────────
insert into public.projects (id, name, description, estate, is_public)
values ('00000000-0000-0000-0000-000000000001',
        'Kebun 77 - Kotawaringin', 'Project utama kebun dan analisis AOI', 'Kebun 77 - Kotawaringin', true)
on conflict (id) do nothing;
update public.blocks set project_id = '00000000-0000-0000-0000-000000000001' where project_id is null;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.projects enable row level security;
drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects for select to authenticated using (true);
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated with check (auth.uid() = owner_id);
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update to authenticated using (auth.uid() = owner_id);
grant select, insert, update on public.projects to authenticated;

-- =====================================================================
-- RPC
-- =====================================================================

-- Daftar project (untuk switcher) + jumlah blok.
create or replace function public.list_projects()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'estate', p.estate, 'description', p.description,
    'share_token', p.share_token, 'is_public', p.is_public,
    'n_blocks', (select count(*) from public.blocks b where b.project_id = p.id)
  ) order by p.created_at), '[]'::jsonb)
  from public.projects p;
$$;

-- Buat project baru (owner = pemanggil).
create or replace function public.create_project(p_name text, p_estate text default null, p_description text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.projects;
begin
  insert into public.projects (name, estate, description, owner_id)
  values (p_name, p_estate, p_description, auth.uid())
  returning * into r;
  return jsonb_build_object('id', r.id, 'name', r.name, 'estate', r.estate,
    'share_token', r.share_token, 'is_public', r.is_public, 'n_blocks', 0);
end $$;

-- Set project publik/privat (hanya owner).
create or replace function public.set_project_public(p_project_id uuid, p_public boolean)
returns void language sql security definer set search_path = public as $$
  update public.projects set is_public = p_public
  where id = p_project_id and owner_id = auth.uid();
$$;

-- FeatureCollection blok — kini di-scope opsional per project.
drop function if exists public.blocks_geojson(text);
create or replace function public.blocks_geojson(p_project_id uuid default null, p_priority text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'crs', jsonb_build_object('type','name','properties',jsonb_build_object('name','urn:ogc:def:crs:OGC:1.3:CRS84')),
    'features', coalesce(jsonb_agg(feat order by rnk asc nulls last), '[]'::jsonb)
  )
  from (
    select c.intervention_rank as rnk,
      jsonb_build_object(
        'type','Feature',
        'geometry', ST_AsGeoJSON(b.geom)::jsonb,
        'properties', jsonb_build_object(
          'block_id', b.block_id, 'estate', b.estate, 'area_ha', b.area_ha,
          'planting_year', b.planting_year, 'age_years', (extract(year from now())::int - b.planting_year),
          'variety', b.variety, 'last_updated', c.period_start,
          'ndvi_value', e.ndvi_mean, 'evi_value', e.evi_mean, 'lai_value', e.lai_mean,
          'lst_celsius', e.lst_celsius, 'rainfall_30d_mm', e.rainfall_30d_mm, 'rainfall_90d_mm', e.rainfall_90d_mm,
          'soil_ph', s.soil_ph, 'soil_soc', s.soil_soc,
          'conditions', coalesce(c.conditions,'[]'::jsonb), 'n_conditions', coalesce(c.n_conditions,0),
          'severity_score', coalesce(c.severity_score,0), 'priority_level', coalesce(c.priority_level,'normal'),
          'interventions', coalesce(c.interventions,'[]'::jsonb), 'n_interventions', coalesce(c.n_interventions,0),
          'yield_baseline_ton_ha', c.yield_baseline_ton_ha,
          'yield_predicted_after_intervention', c.yield_predicted_after_intervention,
          'regression_r2', c.regression_r2, 'composite_score', coalesce(c.composite_score,0),
          'intervention_rank', c.intervention_rank
        )
      ) as feat
    from public.blocks b
    left join lateral (select * from public.block_conditions bc where bc.block_id=b.block_id order by bc.period_start desc limit 1) c on true
    left join lateral (select * from public.eo_readings er where er.block_id=b.block_id order by er.obs_date desc limit 1) e on true
    left join public.soil_properties s on s.block_id=b.block_id
    where (p_project_id is null or b.project_id = p_project_id)
      and (p_priority is null or coalesce(c.priority_level,'normal') = p_priority)
  ) q;
$$;

drop function if exists public.block_summary();
create or replace function public.block_summary(p_project_id uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with latest as (
    select b.block_id, b.area_ha,
      coalesce(c.priority_level,'normal') as priority_level,
      coalesce(c.n_interventions,0) as n_interventions, c.regression_r2
    from public.blocks b
    left join lateral (select * from public.block_conditions bc where bc.block_id=b.block_id order by bc.period_start desc limit 1) c on true
    where (p_project_id is null or b.project_id = p_project_id)
  )
  select jsonb_build_object(
    'tenant_id','demo', 'n_blocks', count(*),
    'total_area_ha', round(coalesce(sum(area_ha),0)::numeric,1),
    'by_priority', jsonb_build_object(
      'critical', count(*) filter (where priority_level='critical'),
      'warning',  count(*) filter (where priority_level='warning'),
      'monitor',  count(*) filter (where priority_level='monitor'),
      'normal',   count(*) filter (where priority_level='normal')),
    'n_need_intervention', count(*) filter (where n_interventions>0),
    'mean_regression_r2', round(coalesce(avg(regression_r2),0)::numeric,2),
    'last_updated', (select max(period_start) from public.block_conditions),
    'data_source','supabase'
  ) from latest;
$$;

-- Share publik: data project by token (tanpa login).
create or replace function public.shared_project(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
    'project', jsonb_build_object('id',p.id,'name',p.name,'estate',p.estate,'description',p.description),
    'summary', public.block_summary(p.id),
    'blocks',  public.blocks_geojson(p.id, null)
  ) end
  from (select * from public.projects where share_token = p_token and is_public limit 1) p;
$$;

grant execute on function public.list_projects()                         to authenticated;
grant execute on function public.create_project(text, text, text)        to authenticated;
grant execute on function public.set_project_public(uuid, boolean)       to authenticated;
grant execute on function public.blocks_geojson(uuid, text)              to anon, authenticated;
grant execute on function public.block_summary(uuid)                     to anon, authenticated;
grant execute on function public.shared_project(text)                    to anon, authenticated;

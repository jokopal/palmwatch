-- PalmWatch — RBAC Fase 1: fondasi keamanan DB
-- =====================================================================
-- Menutup temuan audit S1–S5, R2 (lihat AUDIT_RBAC.md):
--  - Helper is_admin()/is_member() (kanonik dari public.users & project_members)
--  - Tabel project_members (assign akses per user per project)
--  - Harden semua DEFINER RPC: write -> admin, read -> member-scoped
--  - RLS tulis -> admin; RLS baca -> member; revoke anon dari RPC baca-project
--  - Assign akun 'user' ke project Demo
-- Idempoten: aman dijalankan ulang.
-- =====================================================================

-- ── 1. Tabel project_members (dibuat dulu; dirujuk is_member) ─────────────────
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'viewer',   -- 'viewer' (nanti bisa 'editor')
  added_by   uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
alter table public.project_members enable row level security;

-- ── 2. Helper role/membership (DEFINER agar bypass RLS users/members) ────────
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_member(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.project_members m
    where m.project_id = p_project_id and m.user_id = auth.uid()
  );
$$;

grant execute on function public.is_admin()          to authenticated;
grant execute on function public.is_member(uuid)     to authenticated;

drop policy if exists pm_admin_all on public.project_members;
create policy pm_admin_all on public.project_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists pm_self_read on public.project_members;
create policy pm_self_read on public.project_members for select to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.project_members to authenticated;

-- ── 3. Harden RPC WRITE (admin only) ─────────────────────────────────────────

-- create_project
create or replace function public.create_project(
  p_name text, p_estate text default null, p_description text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.projects;
begin
  if not public.is_admin() then raise exception 'Hanya admin yang boleh membuat project' using errcode='42501'; end if;
  insert into public.projects (name, estate, description, owner_id)
  values (p_name, p_estate, p_description, auth.uid())
  returning * into r;
  -- owner otomatis jadi member
  insert into public.project_members (project_id, user_id, role, added_by)
  values (r.id, auth.uid(), 'viewer', auth.uid()) on conflict do nothing;
  return jsonb_build_object('id', r.id, 'name', r.name, 'estate', r.estate,
    'share_token', r.share_token, 'is_public', r.is_public, 'n_blocks', 0);
end $$;

-- set_project_public
create or replace function public.set_project_public(p_project_id uuid, p_public boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Hanya admin' using errcode='42501'; end if;
  update public.projects set is_public = p_public where id = p_project_id;
end $$;

-- import_project_blocks (guard ditambahkan; body asli dipertahankan)
create or replace function public.import_project_blocks(
  p_project_id uuid, p_geojson jsonb, p_id_field text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    feat jsonb; g geometry; bid text; raw_id text; est text;
    prefix text := left(replace(p_project_id::text, '-', ''), 6);
    seq int := 0; n int := 0;
begin
    if not public.is_admin() then raise exception 'Hanya admin yang boleh impor blok' using errcode='42501'; end if;
    if not exists (select 1 from public.projects where id = p_project_id) then
        raise exception 'Project % tidak ditemukan', p_project_id;
    end if;
    for feat in select value from jsonb_array_elements(coalesce(p_geojson->'features', '[]'::jsonb)) as t(value)
    loop
        begin
            g := ST_SetSRID(ST_GeomFromGeoJSON(feat->'geometry'), 4326);
        exception when others then continue; end;
        if g is null or GeometryType(g) not in ('POLYGON', 'MULTIPOLYGON') then continue; end if;
        seq := seq + 1;
        raw_id := coalesce(
            case when p_id_field is not null then feat->'properties'->>p_id_field else null end,
            feat->'properties'->>'block_id', feat->'properties'->>'id',
            feat->'properties'->>'name', lpad(seq::text, 3, '0'));
        bid := prefix || '-' || raw_id;
        est := coalesce(feat->'properties'->>'estate', (select name from public.projects where id = p_project_id));
        insert into public.blocks (block_id, project_id, estate, area_ha, geom, planting_year, variety)
        values (bid, p_project_id, est, round((ST_Area(g::geography) / 10000.0)::numeric, 2), g,
                nullif(feat->'properties'->>'planting_year', '')::int, feat->'properties'->>'variety')
        on conflict (block_id) do update set project_id=excluded.project_id, geom=excluded.geom,
                area_ha=excluded.area_ha, estate=excluded.estate;
        n := n + 1;
    end loop;
    return jsonb_build_object('imported', n, 'project_id', p_project_id);
end $$;

-- ── 4. Harden RPC READ (member-scoped) + revoke anon ─────────────────────────

create or replace function public.list_projects()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'estate', p.estate, 'description', p.description,
    'share_token', p.share_token, 'is_public', p.is_public,
    'n_blocks', (select count(*) from public.blocks b where b.project_id = p.id)
  ) order by p.created_at), '[]'::jsonb)
  from public.projects p
  where public.is_member(p.id);          -- admin lolos semua via is_member
$$;

-- blocks_geojson: baris otomatis di-scope ke project yang boleh diakses
create or replace function public.blocks_geojson(p_project_id uuid default null, p_priority text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'type','FeatureCollection',
    'crs', jsonb_build_object('type','name','properties',jsonb_build_object('name','urn:ogc:def:crs:OGC:1.3:CRS84')),
    'features', coalesce(jsonb_agg(feat order by rnk asc nulls last), '[]'::jsonb)
  )
  from (
    select c.intervention_rank as rnk,
      jsonb_build_object('type','Feature','geometry', ST_AsGeoJSON(b.geom)::jsonb,
        'properties', jsonb_build_object(
          'block_id',b.block_id,'estate',b.estate,'area_ha',b.area_ha,
          'planting_year',b.planting_year,'age_years',(extract(year from now())::int - b.planting_year),
          'variety',b.variety,'last_updated',c.period_start,
          'ndvi_value',e.ndvi_mean,'evi_value',e.evi_mean,'lai_value',e.lai_mean,
          'lst_celsius',e.lst_celsius,'rainfall_30d_mm',e.rainfall_30d_mm,'rainfall_90d_mm',e.rainfall_90d_mm,
          'soil_ph',s.soil_ph,'soil_soc',s.soil_soc,
          'conditions',coalesce(c.conditions,'[]'::jsonb),'n_conditions',coalesce(c.n_conditions,0),
          'severity_score',coalesce(c.severity_score,0),'priority_level',coalesce(c.priority_level,'normal'),
          'interventions',coalesce(c.interventions,'[]'::jsonb),'n_interventions',coalesce(c.n_interventions,0),
          'yield_baseline_ton_ha',c.yield_baseline_ton_ha,
          'yield_predicted_after_intervention',c.yield_predicted_after_intervention,
          'regression_r2',c.regression_r2,'composite_score',coalesce(c.composite_score,0),
          'intervention_rank',c.intervention_rank)) as feat
    from public.blocks b
    left join lateral (select * from public.block_conditions bc where bc.block_id=b.block_id order by bc.period_start desc limit 1) c on true
    left join lateral (select * from public.eo_readings er where er.block_id=b.block_id order by er.obs_date desc limit 1) e on true
    left join public.soil_properties s on s.block_id=b.block_id
    where public.is_member(b.project_id)
      and (p_project_id is null or b.project_id = p_project_id)
      and (p_priority is null or coalesce(c.priority_level,'normal') = p_priority)
  ) q;
$$;

create or replace function public.block_summary(p_project_id uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with latest as (
    select b.block_id, b.area_ha, coalesce(c.priority_level,'normal') as priority_level,
      coalesce(c.n_interventions,0) as n_interventions, c.regression_r2
    from public.blocks b
    left join lateral (select * from public.block_conditions bc where bc.block_id=b.block_id order by bc.period_start desc limit 1) c on true
    where public.is_member(b.project_id) and (p_project_id is null or b.project_id = p_project_id)
  )
  select jsonb_build_object('tenant_id','demo','n_blocks',count(*),
    'total_area_ha', round(coalesce(sum(area_ha),0)::numeric,1),
    'by_priority', jsonb_build_object(
      'critical',count(*) filter (where priority_level='critical'),
      'warning', count(*) filter (where priority_level='warning'),
      'monitor', count(*) filter (where priority_level='monitor'),
      'normal',  count(*) filter (where priority_level='normal')),
    'n_need_intervention', count(*) filter (where n_interventions>0),
    'mean_regression_r2', round(coalesce(avg(regression_r2),0)::numeric,2),
    'last_updated', (select max(period_start) from public.block_conditions),
    'data_source','supabase') from latest;
$$;

create or replace function public.block_timeseries(p_block_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('block_id', p_block_id,
    'series', coalesce(jsonb_agg(jsonb_build_object(
      'date',obs_date,'ndvi',ndvi_mean,'evi',evi_mean,
      'rainfall_30d_mm',rainfall_30d_mm,'tbs_ton_ha',tbs_ton_ha) order by obs_date), '[]'::jsonb))
  from public.eo_readings
  where block_id = p_block_id
    and public.is_member((select project_id from public.blocks where block_id = p_block_id));
$$;

-- Cabut akses anon dari RPC baca-project (publik hanya via shared_project).
revoke execute on function public.blocks_geojson(uuid, text) from anon;
revoke execute on function public.block_summary(uuid)         from anon;
revoke execute on function public.block_timeseries(text)      from anon;

-- ── 5. RLS tabel: tulis -> admin, baca -> member ─────────────────────────────
-- projects
drop policy if exists projects_read   on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
create policy projects_read   on public.projects for select to authenticated using (public.is_member(id));
create policy projects_admin  on public.projects for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- blocks: write admin (ganti cek JWT lama), read member
drop policy if exists "Enable write access for admins only"        on public.blocks;
drop policy if exists "Enable read access for all authenticated users" on public.blocks;
create policy blocks_admin_write on public.blocks for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy blocks_member_read on public.blocks for select to authenticated using (public.is_member(project_id));

-- vector_layers: write admin, read member (atau layer global project_id null)
drop policy if exists vector_layers_insert on public.vector_layers;
drop policy if exists vector_layers_delete on public.vector_layers;
drop policy if exists vector_layers_read   on public.vector_layers;
create policy vlayers_admin_write on public.vector_layers for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy vlayers_member_read on public.vector_layers for select to authenticated using (project_id is null or public.is_member(project_id));

-- ── 6. Assign akun 'user' ke project Demo ────────────────────────────────────
insert into public.project_members (project_id, user_id, role, added_by)
select '00000000-0000-0000-0000-000000000001',
       (select id from public.users where email='user@gmail.com'),
       'viewer',
       (select id from public.users where email='admin@gmail.com')
where exists (select 1 from public.users where email='user@gmail.com')
on conflict do nothing;

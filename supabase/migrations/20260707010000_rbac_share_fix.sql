-- PalmWatch — RBAC Fase 1b: pertahankan share publik setelah member-scoping
-- =====================================================================
-- Fase 1 menambah guard is_member ke blocks_geojson/block_summary. Tapi
-- shared_project (publik, anon) memanggil keduanya -> anon tak punya auth.uid()
-- -> hasil kosong. Solusi: helper internal ber-flag `enforce`:
--   enforce=true  -> dipakai RPC member (blocks_geojson/block_summary)
--   enforce=false -> dipakai shared_project (sudah digate is_public + token)
-- Helper internal TIDAK di-grant ke anon/authenticated (hanya dipanggil DEFINER).
-- =====================================================================

-- ── Helper: FeatureCollection satu/semua project (opsional enforce member) ───
create or replace function public._blocks_fc(p_project_id uuid, p_priority text, p_enforce boolean)
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
    where (not p_enforce or public.is_member(b.project_id))
      and (p_project_id is null or b.project_id = p_project_id)
      and (p_priority is null or coalesce(c.priority_level,'normal') = p_priority)
  ) q;
$$;

create or replace function public._block_summary(p_project_id uuid, p_enforce boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  with latest as (
    select b.block_id, b.area_ha, coalesce(c.priority_level,'normal') as priority_level,
      coalesce(c.n_interventions,0) as n_interventions, c.regression_r2
    from public.blocks b
    left join lateral (select * from public.block_conditions bc where bc.block_id=b.block_id order by bc.period_start desc limit 1) c on true
    where (not p_enforce or public.is_member(b.project_id))
      and (p_project_id is null or b.project_id = p_project_id)
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

-- Helper internal: cabut dari role klien (hanya dipanggil fungsi DEFINER lain).
revoke all on function public._blocks_fc(uuid, text, boolean)  from public, anon, authenticated;
revoke all on function public._block_summary(uuid, boolean)    from public, anon, authenticated;

-- ── RPC member (enforce=true) jadi wrapper tipis ─────────────────────────────
create or replace function public.blocks_geojson(p_project_id uuid default null, p_priority text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select public._blocks_fc(p_project_id, p_priority, true);
$$;

create or replace function public.block_summary(p_project_id uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select public._block_summary(p_project_id, true);
$$;

revoke execute on function public.blocks_geojson(uuid, text) from anon;
revoke execute on function public.block_summary(uuid)         from anon;
grant  execute on function public.blocks_geojson(uuid, text) to authenticated;
grant  execute on function public.block_summary(uuid)         to authenticated;

-- ── shared_project: publik, pakai enforce=false (sudah digate is_public) ─────
create or replace function public.shared_project(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
    'project', jsonb_build_object('id',p.id,'name',p.name,'estate',p.estate,'description',p.description),
    'summary', public._block_summary(p.id, false),
    'blocks',  public._blocks_fc(p.id, null, false)
  ) end
  from (select * from public.projects where share_token = p_token and is_public limit 1) p;
$$;
grant execute on function public.shared_project(text) to anon, authenticated;

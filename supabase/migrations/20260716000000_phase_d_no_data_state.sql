-- =====================================================================
-- Fase D — Bedakan "belum ada data" dari "sehat"
--
-- MASALAH
-- Blok tanpa satu pun baris di block_conditions dihitung sebagai 'normal'
-- lewat coalesce(c.priority_level,'normal'). Akibatnya header menampilkan
-- "5 sehat" untuk kebun yang belum pernah dianalisis sama sekali. Di depan
-- klien itu klaim tanpa dasar: yang benar adalah "belum ada data", bukan
-- "sudah diperiksa dan hasilnya sehat".
--
-- PERUBAHAN
--  1. _blocks_fc  : priority_level = NULL bila tak ada kondisi (bukan 'normal'),
--                   plus flag has_conditions supaya UI bisa memilih empty state
--  2. _block_summary: ember 'no_data' terpisah; metrik agregat jadi NULL
--                   (bukan 0) bila tak ada dasarnya
--  3. tenant_id 'demo' yang di-hardcode diganti nama project sebenarnya
--
-- Idempoten: aman dijalankan ulang.
-- =====================================================================

begin;

-- ── 1. _blocks_fc ────────────────────────────────────────────────────────────
create or replace function public._blocks_fc(p_project_id uuid, p_priority text, p_enforce boolean)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
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
          -- EO: tiap variabel dari observasi terbaru yang punya nilai
          'ndvi_value',e.ndvi_mean,'evi_value',e.evi_mean,'lai_value',e.lai_mean,
          'lst_celsius',e.lst_celsius,
          'temp_2m_mean',e.temp_2m_mean,
          'rainfall_30d_mm',e.rainfall_30d_mm,'rainfall_90d_mm',e.rainfall_90d_mm,
          'et_stress_ratio',e.et_stress_ratio,'soil_moisture',e.soil_moisture,
          'tbs_ton_ha',e.tbs_ton_ha,
          'eo_last_obs',e.last_obs,
          'eo_sources',coalesce(e.sources,'[]'::jsonb),
          -- Tanah (statis, SoilGrids)
          'soil_ph',s.soil_ph,'soil_soc',s.soil_soc,
          'soil_clay',s.soil_clay,'soil_sand',s.soil_sand,
          'soil_cec',s.soil_cec,'soil_nitrogen',s.soil_nitrogen,
          -- Hasil overlay.
          -- has_conditions membedakan "sudah dianalisis, hasilnya bersih" dari
          -- "belum pernah dianalisis". Keduanya dulu tampak identik.
          'has_conditions',(c.block_id is not null),
          'conditions',coalesce(c.conditions,'[]'::jsonb),'n_conditions',coalesce(c.n_conditions,0),
          'severity_score',c.severity_score,
          'priority_level',c.priority_level,
          'interventions',coalesce(c.interventions,'[]'::jsonb),'n_interventions',coalesce(c.n_interventions,0),
          'yield_baseline_ton_ha',c.yield_baseline_ton_ha,
          'yield_predicted_after_intervention',c.yield_predicted_after_intervention,
          'regression_r2',c.regression_r2,'composite_score',c.composite_score,
          'intervention_rank',c.intervention_rank)) as feat
    from public.blocks b
    left join lateral (
      select * from public.block_conditions bc
      where bc.block_id = b.block_id
      order by bc.period_start desc limit 1
    ) c on true
    left join lateral (
      select
        max(er.obs_date) as last_obs,
        (array_agg(er.ndvi_mean       order by er.obs_date desc) filter (where er.ndvi_mean       is not null))[1] as ndvi_mean,
        (array_agg(er.evi_mean        order by er.obs_date desc) filter (where er.evi_mean        is not null))[1] as evi_mean,
        (array_agg(er.lai_mean        order by er.obs_date desc) filter (where er.lai_mean        is not null))[1] as lai_mean,
        (array_agg(er.lst_celsius     order by er.obs_date desc) filter (where er.lst_celsius     is not null))[1] as lst_celsius,
        (array_agg(er.temp_2m_mean    order by er.obs_date desc) filter (where er.temp_2m_mean    is not null))[1] as temp_2m_mean,
        (array_agg(er.rainfall_30d_mm order by er.obs_date desc) filter (where er.rainfall_30d_mm is not null))[1] as rainfall_30d_mm,
        (array_agg(er.rainfall_90d_mm order by er.obs_date desc) filter (where er.rainfall_90d_mm is not null))[1] as rainfall_90d_mm,
        (array_agg(er.et_stress_ratio order by er.obs_date desc) filter (where er.et_stress_ratio is not null))[1] as et_stress_ratio,
        (array_agg(er.soil_moisture   order by er.obs_date desc) filter (where er.soil_moisture   is not null))[1] as soil_moisture,
        (array_agg(er.tbs_ton_ha      order by er.obs_date desc) filter (where er.tbs_ton_ha      is not null))[1] as tbs_ton_ha,
        to_jsonb(array_agg(distinct er.source) filter (where er.source is not null))                                as sources
      from public.eo_readings er
      where er.block_id = b.block_id
    ) e on true
    left join public.soil_properties s on s.block_id = b.block_id
    where (not p_enforce or public.is_member(b.project_id))
      and (p_project_id is null or b.project_id = p_project_id)
      -- Filter 'no_data' menyaring blok yang belum punya kondisi sama sekali.
      and (
        p_priority is null
        or (p_priority = 'no_data' and c.block_id is null)
        or c.priority_level = p_priority
      )
  ) q;
$function$;

-- ── 2. _block_summary ────────────────────────────────────────────────────────
create or replace function public._block_summary(p_project_id uuid, p_enforce boolean)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
  with latest as (
    select b.block_id, b.area_ha, b.project_id,
      c.priority_level,                       -- NULL = belum ada kondisi
      (c.block_id is not null) as has_conditions,
      coalesce(c.n_interventions,0) as n_interventions,
      c.regression_r2
    from public.blocks b
    left join lateral (
      select * from public.block_conditions bc
      where bc.block_id=b.block_id order by bc.period_start desc limit 1
    ) c on true
    where (not p_enforce or public.is_member(b.project_id))
      and (p_project_id is null or b.project_id = p_project_id)
  )
  select jsonb_build_object(
    -- tenant_id dulu di-hardcode 'demo' dan ikut terlihat di payload API.
    -- Tanpa p_project_id, ambil project mana pun yang terlihat pemanggil.
    -- (uuid tidak punya agregat min(), jadi pakai limit 1.)
    'tenant_id', coalesce((select p.name from public.projects p
                           where p.id = coalesce(p_project_id,
                                                 (select l.project_id from latest l
                                                  where l.project_id is not null limit 1))), 'unknown'),
    'n_blocks', count(*),
    'total_area_ha', round(coalesce(sum(area_ha),0)::numeric,1),
    'by_priority', jsonb_build_object(
      'critical', count(*) filter (where priority_level='critical'),
      'warning',  count(*) filter (where priority_level='warning'),
      'monitor',  count(*) filter (where priority_level='monitor'),
      'normal',   count(*) filter (where priority_level='normal'),
      -- Ember baru: blok yang belum pernah dianalisis. Dulu mereka masuk
      -- 'normal' sehingga kebun tanpa analisis apa pun tampak sehat total.
      'no_data',  count(*) filter (where not has_conditions)),
    'n_analyzed', count(*) filter (where has_conditions),
    'n_need_intervention', count(*) filter (where n_interventions>0),
    -- NULL, bukan 0: rata-rata dari himpunan kosong bukanlah nol.
    'mean_regression_r2', (select round(avg(regression_r2)::numeric,2)
                           from latest where regression_r2 is not null),
    'last_updated', (select max(bc.period_start) from public.block_conditions bc
                     join public.blocks b2 on b2.block_id = bc.block_id
                     where p_project_id is null or b2.project_id = p_project_id),
    'data_source','supabase') from latest;
$function$;

commit;

-- ── 3. shared_project: sertakan DAFTAR layer (tanpa geojson) ────────────────
-- Tampilan publik menjanjikan "hasil pengeditan aktual layer oleh admin", tapi
-- RPC ini hanya mengembalikan project + summary + blok. Frontend lalu jatuh ke
-- kueri tabel langsung yang SELALU ditolak untuk pengunjung anonim (401),
-- sehingga link share tak pernah menampilkan satu pun layer.
--
-- PENTING: hanya METADATA yang disertakan, bukan geojson-nya. Total geojson
-- project ini 15 MB (satu layer garis sungai saja 9 MB, dua layer titik pohon
-- masing-masing ~2,9 MB dengan 12.359 fitur). Menyematkan semuanya dalam satu
-- respons membuat halaman share menggantung. Geojson diambil per layer lewat
-- shared_layer_geojson() sesuai kebutuhan.
create or replace function public.shared_project(p_token text)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
  select case when p.id is null then null else jsonb_build_object(
    'project', jsonb_build_object('id',p.id,'name',p.name,'estate',p.estate,'description',p.description),
    'summary', public._block_summary(p.id, false),
    'blocks',  public._blocks_fc(p.id, null, false),
    'vector_layers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'layer_role', v.layer_role,
        'diagnostic_field', v.diagnostic_field, 'period_label', v.period_label,
        'layer_config', v.layer_config,
        'n_features', jsonb_array_length(v.geojson->'features')) order by v.created_at)
      from public.vector_layers v where v.project_id = p.id), '[]'::jsonb),
    'raster_layers', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.created_at)
      from public.raster_layers r where r.project_id = p.id), '[]'::jsonb)
  ) end
  from (select * from public.projects where share_token = p_token and is_public limit 1) p;
$function$;

-- ── 4. shared_layer_geojson: ambil satu layer untuk pengunjung publik ────────
-- Token divalidasi ulang di sini, dan layer wajib milik project yang token itu
-- buka. Tanpa pengecekan itu, siapa pun yang tahu satu token bisa membaca layer
-- project mana pun hanya dengan menebak UUID.
create or replace function public.shared_layer_geojson(p_token text, p_layer_id uuid)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $function$
  select v.geojson
  from public.vector_layers v
  join public.projects p on p.id = v.project_id
  where v.id = p_layer_id
    and p.share_token = p_token
    and p.is_public;
$function$;

revoke all on function public.shared_layer_geojson(text, uuid) from public;
grant execute on function public.shared_layer_geojson(text, uuid) to anon, authenticated;

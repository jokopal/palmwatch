-- PalmWatch — Agregasi EO lintas source untuk properties blok
-- =====================================================================
-- MASALAH
-- `_blocks_fc` mengambil SATU baris eo_readings terbaru per blok
-- (`order by obs_date desc limit 1`), tanpa memandang `source`. Sejak Track C
-- menulis dari beberapa sumber dengan irama berbeda —
--   open-meteo      : bulanan (hujan, suhu udara)
--   sentinel-2-stac : kuartalan (NDVI)
-- — baris terbaru hampir selalu milik open-meteo, sehingga `ndvi_value` tampil
-- NULL di peta, tabel atribut, dan share view MESKIPUN NDVI nyata ada di DB.
--
-- SOLUSI
-- Ambil nilai terbaru YANG TIDAK NULL untuk SETIAP variabel secara terpisah:
--   (array_agg(kolom order by obs_date desc) filter (where kolom is not null))[1]
-- Jadi hujan boleh datang dari baris Desember dan NDVI dari baris Oktober tanpa
-- saling menimpa. `last_updated` tetap dari block_conditions (periode analisis).
--
-- Sekaligus menambah properti yang sudah dikumpulkan Track C tapi belum pernah
-- sampai ke UI: temp_2m_mean (C1), soil_clay/sand/cec/nitrogen (C2),
-- et_stress_ratio & soil_moisture, plus obs_date terakhir per blok.
-- Perubahan bersifat ADITIF — tak ada properti lama yang dihapus/diubah nama.
-- =====================================================================

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
          -- Hasil overlay
          'conditions',coalesce(c.conditions,'[]'::jsonb),'n_conditions',coalesce(c.n_conditions,0),
          'severity_score',coalesce(c.severity_score,0),'priority_level',coalesce(c.priority_level,'normal'),
          'interventions',coalesce(c.interventions,'[]'::jsonb),'n_interventions',coalesce(c.n_interventions,0),
          'yield_baseline_ton_ha',c.yield_baseline_ton_ha,
          'yield_predicted_after_intervention',c.yield_predicted_after_intervention,
          'regression_r2',c.regression_r2,'composite_score',coalesce(c.composite_score,0),
          'intervention_rank',c.intervention_rank)) as feat
    from public.blocks b
    left join lateral (
      select * from public.block_conditions bc
      where bc.block_id = b.block_id
      order by bc.period_start desc limit 1
    ) c on true
    left join lateral (
      -- Nilai terbaru non-null PER VARIABEL (bukan satu baris terbaru saja).
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
      and (p_priority is null or coalesce(c.priority_level,'normal') = p_priority)
  ) q;
$$;

-- Helper internal tetap tertutup dari klien (hanya dipanggil fungsi DEFINER).
revoke all on function public._blocks_fc(uuid, text, boolean) from public, anon, authenticated;

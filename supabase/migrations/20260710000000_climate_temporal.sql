-- PalmWatch — Track C1: kolom suhu udara + block_timeseries multi-variabel
-- =====================================================================
-- Menambah kolom suhu udara 2 m (Open-Meteo/NASA POWER) dan memperluas RPC
-- block_timeseries agar mengembalikan seluruh variabel EO untuk panel Temporal
-- (dataset selector di footer analisis). Guard member-scope dipertahankan.
-- =====================================================================

alter table public.eo_readings
  add column if not exists temp_2m_mean double precision;   -- suhu udara 2 m rata-rata (°C)

comment on column public.eo_readings.temp_2m_mean is 'Suhu udara 2 m rata-rata (°C) dari Open-Meteo/NASA POWER — bukan LST.';

-- block_timeseries: kembalikan semua variabel EO (member-scoped, security definer).
create or replace function public.block_timeseries(p_block_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('block_id', p_block_id,
    'series', coalesce(jsonb_agg(jsonb_build_object(
      'date',            obs_date,
      'source',          source,
      'ndvi',            ndvi_mean,
      'evi',             evi_mean,
      'lai',             lai_mean,
      'fpar',            fpar_mean,
      'lst_celsius',     lst_celsius,
      'temp_2m_mean',    temp_2m_mean,
      'rainfall_30d_mm', rainfall_30d_mm,
      'rainfall_90d_mm', rainfall_90d_mm,
      'soil_moisture',   soil_moisture,
      'et_stress_ratio', et_stress_ratio,
      'tbs_ton_ha',      tbs_ton_ha
    ) order by obs_date), '[]'::jsonb))
  from public.eo_readings
  where block_id = p_block_id
    and public.is_member((select project_id from public.blocks where block_id = p_block_id));
$$;

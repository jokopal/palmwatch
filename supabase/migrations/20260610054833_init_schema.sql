-- PalmWatch — skema basis data (Supabase / PostGIS)
-- =====================================================================
-- Sumber kebenaran tunggal untuk dashboard SIG (Fase 5) dan pipeline EO.
-- Tabel menyimpan blok polygon, pembacaan EO (NDVI/LST/curah hujan/dll.),
-- properti tanah, dan kondisi+intervensi hasil overlay.
--
-- Client (React) TIDAK mengakses tabel langsung. Ia memanggil fungsi RPC
-- (blocks_geojson / block_summary / block_timeseries) yang mengembalikan
-- JSON siap-render. RLS aktif tanpa policy anon -> tabel tertutup; akses
-- hanya lewat fungsi SECURITY DEFINER di bawah.
-- =====================================================================

create extension if not exists postgis;

-- ── Master blok polygon ──────────────────────────────────────────────
create table if not exists public.blocks (
    block_id        text primary key,
    tenant_id       text not null default 'demo',
    estate          text,
    area_ha         double precision,
    planting_year   integer,
    variety         text,
    geom            geometry(Polygon, 4326),
    created_at      timestamptz not null default now()
);
create index if not exists idx_blocks_geom on public.blocks using gist (geom);
create index if not exists idx_blocks_tenant on public.blocks (tenant_id);

-- ── Pembacaan EO temporal (NDVI, LST, curah hujan, ...) ──────────────
-- Satu baris per blok per tanggal observasi. Kolom tbs_ton_ha menampung
-- produksi panen yang diselaraskan periode (di produksi nyata berasal dari
-- data panen perusahaan; di sini disatukan agar time-series mudah dibaca).
create table if not exists public.eo_readings (
    id              bigint generated always as identity primary key,
    block_id        text not null references public.blocks(block_id) on delete cascade,
    obs_date        date not null,
    source          text default 'composite',
    ndvi_mean       double precision,
    evi_mean        double precision,
    lai_mean        double precision,
    fpar_mean       double precision,
    lst_celsius     double precision,
    rainfall_30d_mm double precision,
    rainfall_90d_mm double precision,
    et_stress_ratio double precision,
    soil_moisture   double precision,
    tbs_ton_ha      double precision,
    created_at      timestamptz not null default now(),
    unique (block_id, obs_date, source)
);
create index if not exists idx_eo_block_date on public.eo_readings (block_id, obs_date desc);

-- ── Properti tanah statis ────────────────────────────────────────────
create table if not exists public.soil_properties (
    block_id        text primary key references public.blocks(block_id) on delete cascade,
    soil_ph         double precision,
    soil_soc        double precision,
    soil_clay       double precision,
    soil_sand       double precision,
    soil_cec        double precision,
    soil_nitrogen   double precision,
    updated_at      timestamptz not null default now()
);

-- ── Kondisi + intervensi per blok per periode (hasil overlay Fase 4) ──
create table if not exists public.block_conditions (
    id                                  bigint generated always as identity primary key,
    block_id                            text not null references public.blocks(block_id) on delete cascade,
    period_start                        date not null,
    period_end                          date,
    conditions                          jsonb default '[]'::jsonb,
    n_conditions                        integer default 0,
    severity_score                      double precision default 0,
    priority_level                      text default 'normal',
    interventions                       jsonb default '[]'::jsonb,
    n_interventions                     integer default 0,
    yield_baseline_ton_ha               double precision,
    yield_predicted_after_intervention  double precision,
    regression_r2                       double precision,
    composite_score                     double precision default 0,
    intervention_rank                   integer,
    created_at                          timestamptz not null default now(),
    unique (block_id, period_start)
);
create index if not exists idx_cond_block on public.block_conditions (block_id, period_start desc);
create index if not exists idx_cond_priority on public.block_conditions (priority_level);

-- ── Row Level Security: kunci akses langsung; hanya via RPC definer ───
alter table public.blocks            enable row level security;
alter table public.eo_readings       enable row level security;
alter table public.soil_properties   enable row level security;
alter table public.block_conditions  enable row level security;
-- (sengaja tanpa policy untuk anon: select langsung ditolak)

-- =====================================================================
-- FUNGSI RPC UNTUK CLIENT  (SECURITY DEFINER -> bypass RLS, read-only)
-- =====================================================================

-- FeatureCollection GeoJSON: blok + kondisi terbaru + EO terbaru + tanah.
-- Properties mengikuti persis kontrak web/src/types.ts (BlockProperties).
create or replace function public.blocks_geojson(p_priority text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'crs', jsonb_build_object(
      'type', 'name',
      'properties', jsonb_build_object('name', 'urn:ogc:def:crs:OGC:1.3:CRS84')
    ),
    'features', coalesce(jsonb_agg(feat order by rnk asc nulls last), '[]'::jsonb)
  )
  from (
    select
      c.intervention_rank as rnk,
      jsonb_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(b.geom)::jsonb,
        'properties', jsonb_build_object(
          'block_id', b.block_id,
          'estate', b.estate,
          'area_ha', b.area_ha,
          'planting_year', b.planting_year,
          'age_years', (extract(year from now())::int - b.planting_year),
          'variety', b.variety,
          'last_updated', c.period_start,
          'ndvi_value', e.ndvi_mean,
          'evi_value', e.evi_mean,
          'lai_value', e.lai_mean,
          'lst_celsius', e.lst_celsius,
          'rainfall_30d_mm', e.rainfall_30d_mm,
          'rainfall_90d_mm', e.rainfall_90d_mm,
          'soil_ph', s.soil_ph,
          'soil_soc', s.soil_soc,
          'conditions', coalesce(c.conditions, '[]'::jsonb),
          'n_conditions', coalesce(c.n_conditions, 0),
          'severity_score', coalesce(c.severity_score, 0),
          'priority_level', coalesce(c.priority_level, 'normal'),
          'interventions', coalesce(c.interventions, '[]'::jsonb),
          'n_interventions', coalesce(c.n_interventions, 0),
          'yield_baseline_ton_ha', c.yield_baseline_ton_ha,
          'yield_predicted_after_intervention', c.yield_predicted_after_intervention,
          'regression_r2', c.regression_r2,
          'composite_score', coalesce(c.composite_score, 0),
          'intervention_rank', c.intervention_rank
        )
      ) as feat
    from public.blocks b
    left join lateral (
      select * from public.block_conditions bc
      where bc.block_id = b.block_id
      order by bc.period_start desc limit 1
    ) c on true
    left join lateral (
      select * from public.eo_readings er
      where er.block_id = b.block_id
      order by er.obs_date desc limit 1
    ) e on true
    left join public.soil_properties s on s.block_id = b.block_id
    where p_priority is null or coalesce(c.priority_level, 'normal') = p_priority
  ) q;
$$;

-- KPI ringkas untuk header dashboard.
create or replace function public.block_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select
      b.block_id,
      b.area_ha,
      coalesce(c.priority_level, 'normal') as priority_level,
      coalesce(c.n_interventions, 0) as n_interventions,
      c.regression_r2
    from public.blocks b
    left join lateral (
      select * from public.block_conditions bc
      where bc.block_id = b.block_id
      order by bc.period_start desc limit 1
    ) c on true
  )
  select jsonb_build_object(
    'tenant_id', 'demo',
    'n_blocks', count(*),
    'total_area_ha', round(coalesce(sum(area_ha), 0)::numeric, 1),
    'by_priority', jsonb_build_object(
      'critical', count(*) filter (where priority_level = 'critical'),
      'warning',  count(*) filter (where priority_level = 'warning'),
      'monitor',  count(*) filter (where priority_level = 'monitor'),
      'normal',   count(*) filter (where priority_level = 'normal')
    ),
    'n_need_intervention', count(*) filter (where n_interventions > 0),
    'mean_regression_r2', round(coalesce(avg(regression_r2), 0)::numeric, 2),
    'last_updated', (select max(period_start) from public.block_conditions),
    'data_source', 'supabase'
  )
  from latest;
$$;

-- Time-series bulanan satu blok (NDVI/EVI/curah hujan vs produksi TBS).
create or replace function public.block_timeseries(p_block_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'block_id', p_block_id,
    'series', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', obs_date,
          'ndvi', ndvi_mean,
          'evi', evi_mean,
          'rainfall_30d_mm', rainfall_30d_mm,
          'tbs_ton_ha', tbs_ton_ha
        ) order by obs_date
      ),
      '[]'::jsonb
    )
  )
  from public.eo_readings
  where block_id = p_block_id;
$$;

-- ── Hak akses: anon & authenticated hanya boleh memanggil RPC ────────
grant usage on schema public to anon, authenticated;
grant execute on function public.blocks_geojson(text)   to anon, authenticated;
grant execute on function public.block_summary()         to anon, authenticated;
grant execute on function public.block_timeseries(text)  to anon, authenticated;

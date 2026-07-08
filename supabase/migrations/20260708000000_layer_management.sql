-- PalmWatch — Layer Management System Extension
-- ====================================================================
-- Menambahkan:
--   1. Kolom metadata ke vector_layers (role, diagnostic_field, period_label, layer_config)
--   2. Tabel production_data (Table Layer permanen — join ke blok)
--   3. Tabel analysis_results (simpan hasil intersect per project)
--   4. RPC run_layer_analysis    — PostGIS intersect server-side
--   5. RPC save_analysis_result  — simpan hasil ke DB + buat vector_layer baru
--   6. RPC list_temporal_layers  — list snapshot temporal satu layer group
--   7. RPC get_production_data   — ambil data produksi untuk project
-- ====================================================================

-- ── 1. Extend vector_layers ──────────────────────────────────────────
alter table public.vector_layers
  add column if not exists layer_role     text not null default 'reference',
  -- 'reference' | 'analysis_result'
  add column if not exists diagnostic_field text,
  -- field yang jadi dasar klasifikasi (mis. "kelas_ndvi")
  add column if not exists period_label   text,
  -- label periode untuk temporal (mis. "2024-03", "2025-Q1")
  add column if not exists period_date    date,
  -- tanggal aktual untuk sorting temporal
  add column if not exists layer_group    text,
  -- grouping untuk temporal: semua snapshot layer sama pakai group id yang sama
  add column if not exists layer_config   jsonb default '{}'::jsonb,
  -- menyimpan: { classes: [{value, label, color, isProblematic}], weight, sourceLayerId }
  add column if not exists project_id     uuid references public.projects(id) on delete set null;

-- Index baru
create index if not exists idx_vl_role        on public.vector_layers (layer_role);
create index if not exists idx_vl_group       on public.vector_layers (layer_group);
create index if not exists idx_vl_project     on public.vector_layers (project_id);
create index if not exists idx_vl_period_date on public.vector_layers (period_date);

-- Policy update: tambah update untuk owner
drop policy if exists vector_layers_update on public.vector_layers;
create policy vector_layers_update on public.vector_layers
  for update to authenticated using (auth.uid() = created_by);
grant update on public.vector_layers to authenticated;

-- ── 2. Tabel production_data ──────────────────────────────────────────
-- Data produksi lapangan (dari Excel/CSV), di-join ke block layer.
create table if not exists public.production_data (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  name          text not null,                -- nama dataset (mis. "FFB 2024")
  join_field    text not null default 'block_id',
  value_fields  text[] not null default '{}',  -- kolom produksi yang ditampilkan
  rows          jsonb not null default '[]'::jsonb, -- array of {block_id, ...values}
  row_count     integer not null default 0,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_pd_project on public.production_data (project_id);

alter table public.production_data enable row level security;

create policy pd_read on public.production_data
  for select to anon, authenticated using (true);
create policy pd_insert on public.production_data
  for insert to authenticated with check (auth.uid() = created_by);
create policy pd_delete on public.production_data
  for delete to authenticated using (auth.uid() = created_by);

grant select on public.production_data to anon, authenticated;
grant insert, delete on public.production_data to authenticated;

-- ── 3. Tabel analysis_results ────────────────────────────────────────
-- Menyimpan metadata hasil run analisis (zona intersect + block summary).
create table if not exists public.analysis_results (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references public.projects(id) on delete cascade,
  name            text not null default 'Analisis',
  block_layer_id  uuid references public.vector_layers(id) on delete set null,
  ref_layer_ids   uuid[] not null default '{}',
  table_layer_id  uuid references public.production_data(id) on delete set null,
  block_summaries jsonb not null default '[]'::jsonb,
  zones_geojson   jsonb,   -- FeatureCollection hasil intersect (disimpan di vector_layers juga)
  result_layer_id uuid references public.vector_layers(id) on delete set null,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ar_project on public.analysis_results (project_id);

alter table public.analysis_results enable row level security;
create policy ar_read on public.analysis_results
  for select to anon, authenticated using (true);
create policy ar_insert on public.analysis_results
  for insert to authenticated with check (auth.uid() = created_by);

grant select on public.analysis_results to anon, authenticated;
grant insert on public.analysis_results to authenticated;

-- ====================================================================
-- RPC 1: run_layer_analysis
-- Intersect block geometries dengan satu/beberapa reference layers (via geojson).
-- Client kirim: block_layer_geojson + array ref_layers (geojson + config per layer)
-- Server return: zones FeatureCollection + block_summaries JSON
-- ====================================================================
create or replace function public.run_layer_analysis(
  p_block_geojson    jsonb,   -- FeatureCollection blok (dari vector_layers.geojson)
  p_ref_layers       jsonb,   -- [{id, name, geojson, diagnostic_field, classes:[{value,label,isProblematic}], weight}]
  p_project_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec           record;
  v_block_feature jsonb;
  v_ref_feature   jsonb;
  v_zones         jsonb := '[]'::jsonb;
  v_block_summaries jsonb := '[]'::jsonb;
  v_intersect_geom geometry;
  v_block_geom     geometry;
  v_ref_geom       geometry;
  v_area_ha        double precision;
  v_zone_props     jsonb;
  v_block_id       text;
  v_ref_layer      jsonb;
  v_class_value    text;
  v_is_problematic boolean;
  v_block_zones    jsonb;
  v_problematic_area double precision;
  v_total_area     double precision;
  v_diagnosis      text;
  v_block_summary  jsonb;
  v_zone_id        bigint := 0;
begin
  -- Iterasi setiap blok
  for v_block_feature in
    select value from jsonb_array_elements(p_block_geojson->'features')
  loop
    v_block_id   := v_block_feature->'properties'->>'block_id';
    v_block_geom := ST_GeomFromGeoJSON(v_block_feature->>'geometry');
    v_block_zones := '[]'::jsonb;
    v_problematic_area := 0;
    v_total_area := ST_Area(v_block_geom::geography) / 10000.0; -- to ha

    -- Iterasi setiap reference layer
    for v_ref_layer in select value from jsonb_array_elements(p_ref_layers)
    loop
      -- Iterasi setiap feature reference layer
      for v_ref_feature in
        select value from jsonb_array_elements(v_ref_layer->'geojson'->'features')
      loop
        v_ref_geom := ST_GeomFromGeoJSON(v_ref_feature->>'geometry');

        -- Intersect blok dengan ref feature
        if ST_Intersects(v_block_geom, v_ref_geom) then
          v_intersect_geom := ST_Intersection(v_block_geom, v_ref_geom);
          v_area_ha := ST_Area(v_intersect_geom::geography) / 10000.0;

          if v_area_ha > 0.001 then -- filter zona sangat kecil (< 10m2)
            v_class_value := v_ref_feature->'properties'->>(v_ref_layer->>'diagnostic_field');

            -- Cek apakah kelas ini problematic
            v_is_problematic := false;
            for v_rec in select value from jsonb_array_elements(v_ref_layer->'classes')
            loop
              if v_rec.value->>'value' = v_class_value
                 and (v_rec.value->>'isProblematic')::boolean = true then
                v_is_problematic := true;
                v_problematic_area := v_problematic_area + v_area_ha;
              end if;
            end loop;

            v_zone_id := v_zone_id + 1;
            v_zone_props := jsonb_build_object(
              'zone_id',         v_zone_id,
              'block_id',        v_block_id,
              'ref_layer_id',    v_ref_layer->>'id',
              'ref_layer_name',  v_ref_layer->>'name',
              'class_value',     v_class_value,
              'diagnostic_field',v_ref_layer->>'diagnostic_field',
              'is_problematic',  v_is_problematic,
              'area_ha',         round(v_area_ha::numeric, 3),
              'weight',          (v_ref_layer->>'weight')::double precision
            );

            v_zones := v_zones || jsonb_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(v_intersect_geom)::jsonb,
              'properties', v_zone_props
            );
            v_block_zones := v_block_zones || v_zone_props;
          end if;
        end if;
      end loop; -- ref features
    end loop; -- ref layers

    -- Build block summary
    v_diagnosis := case
      when v_problematic_area / nullif(v_total_area, 0) > 0.5 then 'Kritis'
      when v_problematic_area / nullif(v_total_area, 0) > 0.25 then 'Peringatan'
      when v_problematic_area / nullif(v_total_area, 0) > 0.1 then 'Pantau'
      else 'Normal'
    end;

    v_block_summary := jsonb_build_object(
      'block_id',          v_block_id,
      'total_area_ha',     round(v_total_area::numeric, 2),
      'problematic_ha',    round(v_problematic_area::numeric, 3),
      'problematic_pct',   round((v_problematic_area / nullif(v_total_area, 0) * 100)::numeric, 1),
      'dominant_diagnosis',v_diagnosis,
      'zone_count',        jsonb_array_length(v_block_zones),
      'zones',             v_block_zones
    );
    v_block_summaries := v_block_summaries || v_block_summary;
  end loop; -- blocks

  return jsonb_build_object(
    'zones', jsonb_build_object('type', 'FeatureCollection', 'features', v_zones),
    'block_summaries', v_block_summaries,
    'zone_count', jsonb_array_length(v_zones),
    'block_count', jsonb_array_length(v_block_summaries)
  );
end;
$$;

grant execute on function public.run_layer_analysis(jsonb, jsonb, uuid) to authenticated;

-- ====================================================================
-- RPC 2: save_analysis_result
-- Simpan hasil analisis ke DB + buat vector_layer baru untuk zona
-- ====================================================================
create or replace function public.save_analysis_result(
  p_project_id       uuid,
  p_name             text,
  p_block_layer_id   uuid,
  p_ref_layer_ids    uuid[],
  p_block_summaries  jsonb,
  p_zones_geojson    jsonb,
  p_table_layer_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid;
  v_zone_layer uuid;
  v_result_id  uuid;
begin
  select auth.uid() into v_uid;
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  -- Simpan zona sebagai vector_layer baru
  insert into public.vector_layers (name, kind, layer_role, feature_count, geojson, created_by, project_id)
  values (
    p_name || ' - Zona Analisis',
    'analysis_zone',
    'analysis_result',
    jsonb_array_length(p_zones_geojson->'features'),
    p_zones_geojson,
    v_uid,
    p_project_id
  )
  returning id into v_zone_layer;

  -- Simpan metadata hasil analisis
  insert into public.analysis_results
    (project_id, name, block_layer_id, ref_layer_ids, table_layer_id,
     block_summaries, zones_geojson, result_layer_id, created_by)
  values
    (p_project_id, p_name, p_block_layer_id, p_ref_layer_ids, p_table_layer_id,
     p_block_summaries, p_zones_geojson, v_zone_layer, v_uid)
  returning id into v_result_id;

  return jsonb_build_object(
    'result_id',      v_result_id,
    'zone_layer_id',  v_zone_layer
  );
end;
$$;

grant execute on function public.save_analysis_result(uuid, text, uuid, uuid[], jsonb, jsonb, uuid)
  to authenticated;

-- ====================================================================
-- RPC 3: list_temporal_layers
-- Ambil semua snapshot temporal dari satu layer_group, urut by period_date
-- ====================================================================
create or replace function public.list_temporal_layers(p_layer_group text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',               id,
        'name',             name,
        'period_label',     period_label,
        'period_date',      period_date,
        'diagnostic_field', diagnostic_field,
        'layer_config',     layer_config,
        'feature_count',    feature_count,
        'created_at',       created_at
      )
      order by period_date asc nulls last
    ),
    '[]'::jsonb
  )
  from public.vector_layers
  where layer_group = p_layer_group
    and layer_role = 'reference'
    and period_label is not null;
$$;

grant execute on function public.list_temporal_layers(text) to anon, authenticated;

-- ====================================================================
-- RPC 4: upsert_production_data
-- Simpan/update Table Layer (Excel/CSV) ke production_data
-- ====================================================================
create or replace function public.upsert_production_data(
  p_project_id   uuid,
  p_name         text,
  p_join_field   text,
  p_value_fields text[],
  p_rows         jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_id  uuid;
begin
  select auth.uid() into v_uid;
  if v_uid is null then raise exception 'Authentication required'; end if;

  insert into public.production_data
    (project_id, name, join_field, value_fields, rows, row_count, created_by)
  values
    (p_project_id, p_name, p_join_field, p_value_fields, p_rows,
     jsonb_array_length(p_rows), v_uid)
  on conflict do nothing
  returning id into v_id;

  -- Jika sudah ada, update
  if v_id is null then
    update public.production_data
    set name = p_name, value_fields = p_value_fields, rows = p_rows,
        row_count = jsonb_array_length(p_rows)
    where project_id = p_project_id and created_by = v_uid
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.upsert_production_data(uuid, text, text, text[], jsonb)
  to authenticated;

-- ====================================================================
-- RPC 5: list_analysis_results
-- Ambil riwayat hasil analisis untuk satu project
-- ====================================================================
create or replace function public.list_analysis_results(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',             id,
        'name',           name,
        'ref_layer_count',array_length(ref_layer_ids, 1),
        'zone_count',     jsonb_array_length(block_summaries),
        'result_layer_id',result_layer_id,
        'created_at',     created_at
      )
      order by created_at desc
    ),
    '[]'::jsonb
  )
  from public.analysis_results
  where project_id = p_project_id;
$$;

grant execute on function public.list_analysis_results(uuid) to anon, authenticated;

-- ====================================================================
-- RPC 6: list_reference_layers (dengan metadata lengkap)
-- ====================================================================
create or replace function public.list_reference_layers(p_project_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',               id,
        'name',             name,
        'layer_role',       layer_role,
        'diagnostic_field', diagnostic_field,
        'period_label',     period_label,
        'period_date',      period_date,
        'layer_group',      layer_group,
        'layer_config',     layer_config,
        'feature_count',    feature_count,
        'project_id',       project_id,
        'created_at',       created_at
      )
      order by created_at desc
    ),
    '[]'::jsonb
  )
  from public.vector_layers
  where layer_role in ('reference', 'analysis_result')
    and (p_project_id is null or project_id = p_project_id or project_id is null);
$$;

grant execute on function public.list_reference_layers(uuid) to anon, authenticated;

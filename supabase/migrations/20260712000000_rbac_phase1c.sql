-- PalmWatch — RBAC Fase 1c: menutup sisa temuan S3 & S5
-- =====================================================================
-- AUDIT_RBAC.md bagian C.4 mewajibkan SEMUA DEFINER RPC dihardening. Fase 1
-- (20260707000000) baru menyelesaikan create_project, set_project_public, dan
-- import_project_blocks. RPC yang lahir di 20260708000000_layer_management.sql
-- terlewat sepenuhnya karena timestamp-nya LEBIH BARU dari migrasi RBAC:
--
--   S5 (tulis tanpa cek role) : run_layer_analysis, save_analysis_result,
--                               upsert_production_data
--   S3 (baca lintas tenant)   : list_reference_layers, list_temporal_layers,
--                               list_analysis_results — DEFINER, grant ke anon,
--                               tanpa cek membership sama sekali
--   RLS terbuka               : production_data & analysis_results memakai
--                               `for select to anon, authenticated using (true)`
--                               → siapa pun, bahkan tanpa login, bisa membaca
--                               data produksi & hasil analisis semua klien.
--
-- Migrasi ini menegakkan pola yang sama dengan Fase 1: tulis = is_admin(),
-- baca = is_member() (admin lolos otomatis), anon dicabut.
--
-- Bonus perbaikan korektness: upsert_production_data sebelumnya memakai
-- `on conflict do nothing` padahal tabel tak punya constraint unik apa pun —
-- sehingga cabang UPDATE tak pernah tereksekusi dan setiap unggah Excel
-- menumpuk baris duplikat. Ditambahkan unique (project_id, name).
-- Idempoten: aman dijalankan ulang.
-- =====================================================================

-- ── 1. RPC tulis -> admin only ───────────────────────────────────────────────

create or replace function public.run_layer_analysis(
  p_block_geojson    jsonb,
  p_ref_layers       jsonb,
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
  if not public.is_admin() then
    raise exception 'Hanya admin yang boleh menjalankan analisis' using errcode='42501';
  end if;

  for v_block_feature in
    select value from jsonb_array_elements(p_block_geojson->'features')
  loop
    v_block_id   := v_block_feature->'properties'->>'block_id';
    v_block_geom := ST_GeomFromGeoJSON(v_block_feature->>'geometry');
    v_block_zones := '[]'::jsonb;
    v_problematic_area := 0;
    v_total_area := ST_Area(v_block_geom::geography) / 10000.0;

    for v_ref_layer in select value from jsonb_array_elements(p_ref_layers)
    loop
      for v_ref_feature in
        select value from jsonb_array_elements(v_ref_layer->'geojson'->'features')
      loop
        v_ref_geom := ST_GeomFromGeoJSON(v_ref_feature->>'geometry');

        if ST_Intersects(v_block_geom, v_ref_geom) then
          v_intersect_geom := ST_Intersection(v_block_geom, v_ref_geom);
          v_area_ha := ST_Area(v_intersect_geom::geography) / 10000.0;

          if v_area_ha > 0.001 then
            v_class_value := v_ref_feature->'properties'->>(v_ref_layer->>'diagnostic_field');

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
      end loop;
    end loop;

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
  end loop;

  return jsonb_build_object(
    'zones', jsonb_build_object('type', 'FeatureCollection', 'features', v_zones),
    'block_summaries', v_block_summaries,
    'zone_count', jsonb_array_length(v_zones),
    'block_count', jsonb_array_length(v_block_summaries)
  );
end;
$$;

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
  if not public.is_admin() then
    raise exception 'Hanya admin yang boleh menyimpan hasil analisis' using errcode='42501';
  end if;
  select auth.uid() into v_uid;

  insert into public.vector_layers (name, kind, layer_role, feature_count, geojson, created_by, project_id)
  values (
    p_name || ' - Zona Analisis', 'analysis_zone', 'analysis_result',
    jsonb_array_length(p_zones_geojson->'features'), p_zones_geojson, v_uid, p_project_id
  )
  returning id into v_zone_layer;

  insert into public.analysis_results
    (project_id, name, block_layer_id, ref_layer_ids, table_layer_id,
     block_summaries, zones_geojson, result_layer_id, created_by)
  values
    (p_project_id, p_name, p_block_layer_id, p_ref_layer_ids, p_table_layer_id,
     p_block_summaries, p_zones_geojson, v_zone_layer, v_uid)
  returning id into v_result_id;

  return jsonb_build_object('result_id', v_result_id, 'zone_layer_id', v_zone_layer);
end;
$$;

-- ── 2. production_data: unique key + upsert yang benar-benar upsert ──────────
-- Buang duplikat lama (pertahankan yang terbaru) agar index unik bisa dibuat.
delete from public.production_data a
  using public.production_data b
 where a.project_id = b.project_id
   and a.name = b.name
   and a.created_at < b.created_at;

create unique index if not exists uq_production_data_project_name
  on public.production_data (project_id, name);

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
  if not public.is_admin() then
    raise exception 'Hanya admin yang boleh mengunggah data produksi' using errcode='42501';
  end if;
  select auth.uid() into v_uid;

  insert into public.production_data
    (project_id, name, join_field, value_fields, rows, row_count, created_by)
  values
    (p_project_id, p_name, p_join_field, p_value_fields, p_rows,
     jsonb_array_length(p_rows), v_uid)
  on conflict (project_id, name) do update
    set join_field   = excluded.join_field,
        value_fields = excluded.value_fields,
        rows         = excluded.rows,
        row_count    = excluded.row_count
  returning id into v_id;

  return v_id;
end;
$$;

-- ── 3. RPC baca -> member-scoped, anon dicabut ──────────────────────────────

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
        'id', id, 'name', name, 'layer_role', layer_role,
        'diagnostic_field', diagnostic_field,
        'period_label', period_label, 'period_date', period_date,
        'layer_group', layer_group, 'layer_config', layer_config,
        'feature_count', feature_count, 'project_id', project_id,
        'created_at', created_at
      ) order by created_at desc
    ), '[]'::jsonb)
  from public.vector_layers
  where layer_role in ('reference', 'analysis_result')
    -- Layer global (project_id null) terlihat semua member; sisanya digerbang.
    and (project_id is null or public.is_member(project_id))
    and (p_project_id is null or project_id = p_project_id or project_id is null);
$$;

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
        'id', id, 'name', name,
        'period_label', period_label, 'period_date', period_date,
        'diagnostic_field', diagnostic_field, 'layer_config', layer_config,
        'feature_count', feature_count, 'created_at', created_at
      ) order by period_date asc nulls last
    ), '[]'::jsonb)
  from public.vector_layers
  where layer_group = p_layer_group
    and layer_role = 'reference'
    and period_label is not null
    and (project_id is null or public.is_member(project_id));
$$;

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
        'id', id, 'name', name,
        'ref_layer_count', array_length(ref_layer_ids, 1),
        'zone_count', jsonb_array_length(block_summaries),
        'result_layer_id', result_layer_id, 'created_at', created_at
      ) order by created_at desc
    ), '[]'::jsonb)
  from public.analysis_results
  where project_id = p_project_id
    and public.is_member(p_project_id);
$$;

-- PENTING: CREATE FUNCTION memberi EXECUTE ke role PUBLIC secara default, dan
-- `anon` mewarisinya. Mencabut dari `anon` saja TIDAK cukup — harus dicabut
-- dari PUBLIC dulu, baru diberikan eksplisit ke authenticated.
revoke execute on function public.list_reference_layers(uuid) from public, anon;
revoke execute on function public.list_temporal_layers(text)  from public, anon;
revoke execute on function public.list_analysis_results(uuid) from public, anon;
grant  execute on function public.list_reference_layers(uuid) to authenticated;
grant  execute on function public.list_temporal_layers(text)  to authenticated;
grant  execute on function public.list_analysis_results(uuid) to authenticated;

-- Pastikan RPC baca-project Fase 1 juga benar-benar tertutup dari anon
-- (revoke lama hanya menyasar `anon`, PUBLIC-nya tertinggal).
revoke execute on function public.blocks_geojson(uuid, text) from public, anon;
revoke execute on function public.block_summary(uuid)        from public, anon;
revoke execute on function public.block_timeseries(text)     from public, anon;
grant  execute on function public.blocks_geojson(uuid, text) to authenticated;
grant  execute on function public.block_summary(uuid)        to authenticated;
grant  execute on function public.block_timeseries(text)     to authenticated;

-- ── 4. RLS tabel: tulis admin, baca member, anon dicabut ────────────────────

-- production_data
drop policy if exists pd_read        on public.production_data;
drop policy if exists pd_insert      on public.production_data;
drop policy if exists pd_delete      on public.production_data;
drop policy if exists pd_admin_write on public.production_data;
drop policy if exists pd_member_read on public.production_data;
create policy pd_admin_write on public.production_data for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy pd_member_read on public.production_data for select to authenticated
  using (public.is_member(project_id));
revoke all on public.production_data from anon;
grant select, insert, update, delete on public.production_data to authenticated;

-- analysis_results
drop policy if exists ar_read        on public.analysis_results;
drop policy if exists ar_insert      on public.analysis_results;
drop policy if exists ar_admin_write on public.analysis_results;
drop policy if exists ar_member_read on public.analysis_results;
create policy ar_admin_write on public.analysis_results for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy ar_member_read on public.analysis_results for select to authenticated
  using (project_id is null or public.is_member(project_id));
revoke all on public.analysis_results from anon;
grant select, insert, update, delete on public.analysis_results to authenticated;

-- vector_layers: buang jalur update berbasis created_by (Fase 1 sudah menetapkan
-- tulis = admin; policy lama ini membuka update untuk non-admin pembuat baris).
drop policy if exists vector_layers_update on public.vector_layers;

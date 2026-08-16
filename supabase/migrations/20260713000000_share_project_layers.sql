-- PalmWatch — Share Project Layers Fix
-- =====================================================================
-- Mengembalikan vector_layers dan raster_layers hasil pengeditan admin
-- langsung di dalam SECURITY DEFINER RPC `shared_project(p_token text)`
-- sehingga pengguna publik / anonim tanpa login dapat melihat layer &
-- simbologi aktual secara read-only.
-- =====================================================================

create or replace function public.shared_project(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
    'project', jsonb_build_object('id',p.id,'name',p.name,'estate',p.estate,'description',p.description),
    'summary', public._block_summary(p.id, false),
    'blocks',  public._blocks_fc(p.id, null, false),
    'vector_layers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', vl.id,
        'name', vl.name,
        'layer_role', vl.layer_role,
        'diagnostic_field', vl.diagnostic_field,
        'period_label', vl.period_label,
        'period_date', vl.period_date,
        'layer_group', vl.layer_group,
        'layer_config', vl.layer_config,
        'geojson', vl.geojson
      )), '[]'::jsonb)
      from public.vector_layers vl
      where vl.project_id = p.id or vl.project_id is null
    ),
    'raster_layers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', rl.id,
        'name', rl.name,
        'storage_path', rl.storage_path,
        'category', rl.category,
        'bounds', rl.bounds,
        'colormap', rl.colormap,
        'min_value', rl.min_value,
        'max_value', rl.max_value,
        'opacity', rl.opacity
      )), '[]'::jsonb)
      from public.raster_layers rl
      where rl.project_id = p.id or rl.project_id is null
    )
  ) end
  from (select * from public.projects where share_token = p_token and is_public limit 1) p;
$$;

grant execute on function public.shared_project(text) to anon, authenticated;

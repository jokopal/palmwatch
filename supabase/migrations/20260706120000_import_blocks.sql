-- PalmWatch — Import SHP/GeoJSON boundary sebagai blok produksi per project (#2)
-- =====================================================================
-- Blok tidak lagi bergantung seed demo: boundary yang diupload menjadi blok
-- nyata milik project. block_id diberi prefix project agar unik lintas project
-- (composite PK penuh = follow-up). geom dilonggarkan ke Geometry agar menerima
-- Polygon & MultiPolygon.
-- =====================================================================

alter table public.blocks alter column geom type geometry(Geometry, 4326);

create or replace function public.import_project_blocks(
    p_project_id uuid,
    p_geojson jsonb,
    p_id_field text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    feat jsonb;
    g geometry;
    bid text;
    raw_id text;
    est text;
    prefix text := left(replace(p_project_id::text, '-', ''), 6);
    seq int := 0;
    n int := 0;
begin
    if not exists (select 1 from public.projects where id = p_project_id) then
        raise exception 'Project % tidak ditemukan', p_project_id;
    end if;

    for feat in select value from jsonb_array_elements(coalesce(p_geojson->'features', '[]'::jsonb)) as t(value)
    loop
        begin
            g := ST_SetSRID(ST_GeomFromGeoJSON(feat->'geometry'), 4326);
        exception when others then
            continue; -- lewati fitur tanpa geometri valid
        end;
        if g is null or GeometryType(g) not in ('POLYGON', 'MULTIPOLYGON') then
            continue;
        end if;

        seq := seq + 1;
        raw_id := coalesce(
            case when p_id_field is not null then feat->'properties'->>p_id_field else null end,
            feat->'properties'->>'block_id',
            feat->'properties'->>'id',
            feat->'properties'->>'name',
            lpad(seq::text, 3, '0')
        );
        bid := prefix || '-' || raw_id;
        est := coalesce(feat->'properties'->>'estate', (select name from public.projects where id = p_project_id));

        insert into public.blocks (block_id, project_id, estate, area_ha, geom,
                                   planting_year, variety)
        values (bid, p_project_id, est,
                round((ST_Area(g::geography) / 10000.0)::numeric, 2), g,
                nullif(feat->'properties'->>'planting_year', '')::int,
                feat->'properties'->>'variety')
        on conflict (block_id) do update
            set project_id = excluded.project_id,
                geom       = excluded.geom,
                area_ha    = excluded.area_ha,
                estate     = excluded.estate;
        n := n + 1;
    end loop;

    return jsonb_build_object('imported', n, 'project_id', p_project_id);
end $$;

grant execute on function public.import_project_blocks(uuid, jsonb, text) to authenticated;

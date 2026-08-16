-- PalmWatch — Seed Parameter COG Rasters
-- =====================================================================
-- Memasukkan metadata raster COG default dari folder 03_Parameter ke tabel
-- public.raster_layers untuk project utama (Kebun 77 - Kotawaringin)
-- =====================================================================

insert into public.raster_layers (id, project_id, name, storage_path, category, bounds, colormap, min_value, max_value, opacity)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'DEM DEMNAS 8m', '/cogs/DEM_DEMNAS_8m.tif', 'dem', '[111.698695, -2.566232, 111.712871, -2.555731]'::jsonb, 'BrewerSpectral9', 0.59, 13.81, 1.0),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'DEM Ortho 5m', '/cogs/DEM_Ortho_5m.tif', 'dem', '[111.698732, -2.566199, 111.71286, -2.555787]'::jsonb, 'Terrain', 15.95, 73.59, 1.0),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'Slope Derajat', '/cogs/Slope_Derajat.tif', 'slope', '[111.698499, -2.566397, 111.713051, -2.555617]'::jsonb, 'Magma', 0.0, 3.0, 1.0),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', 'TWI Kebun', '/cogs/TWI_Kebun.tif', 'twi', '[111.698499, -2.566397, 111.713051, -2.555617]'::jsonb, 'Teal', 8.6, 19.1, 1.0),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000005', 'HAND Drainase', '/cogs/HAND_Drainase.tif', 'hand', '[111.698499, -2.566397, 111.713051, -2.555617]'::jsonb, 'Blues', 0.0, 9.7, 1.0),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000006', 'pH Tanah', '/cogs/pH_Tanah.tif', 'soil', '[111.698499, -2.566397, 111.713051, -2.555617]'::jsonb, 'YlOrBr', 4.7, 5.4, 1.0),
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000007', 'SOC Karbon Organik', '/cogs/SOC_Karbon_Organik.tif', 'soil', '[111.698499, -2.566397, 111.713051, -2.555617]'::jsonb, 'Oranges', 117.6, 171.7, 1.0),
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000008', 'Tekstur Liat', '/cogs/Tekstur_Liat.tif', 'soil', '[111.698499, -2.566397, 111.713051, -2.555617]'::jsonb, 'YlGn', 33.8, 40.3, 1.0),
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000009', 'Curah Hujan Tahunan', '/cogs/Curah_Hujan_Tahunan.tif', 'rainfall', '[111.650511, -2.600012, 111.750511, -2.550012]'::jsonb, 'Blues', 3281.11, 3307.61, 1.0)
on conflict (id) do update set
  name = excluded.name,
  storage_path = excluded.storage_path,
  category = excluded.category,
  bounds = excluded.bounds,
  colormap = excluded.colormap,
  min_value = excluded.min_value,
  max_value = excluded.max_value;

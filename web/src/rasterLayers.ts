import { getCogMetadata } from "@geomatico/maplibre-cog-protocol";
import { supabase } from "./supabase";
import type { AvailableLayer, RasterLayerConfig } from "./store/mapStore";

// CRUD raster COG (tabel public.raster_layers + bucket Storage 'rasters', via
// PostgREST + RLS). File biner disimpan sebagai Cloud-Optimized GeoTIFF dan
// di-render di client via maplibre-cog-protocol (range request) — tanpa server tile.

const BUCKET = "rasters";

interface RasterRow {
  id: string;
  name: string;
  storage_path: string;
  category: string;
  bounds: [number, number, number, number] | null;
  colormap: string | null;
  min_value: number | null;
  max_value: number | null;
  opacity: number | null;
}

/** URL publik ke file COG di bucket 'rasters'. */
export function rasterPublicUrl(storagePath: string): string {
  if (!supabase) return storagePath;
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

function rowToAvailable(r: RasterRow): AvailableLayer {
  const cfg: RasterLayerConfig = {
    url: rasterPublicUrl(r.storage_path),
    colormap: r.colormap ?? undefined,
    minValue: r.min_value ?? undefined,
    maxValue: r.max_value ?? undefined,
    bounds: r.bounds ?? undefined,
    category: r.category,
    opacity: r.opacity ?? 1,
  };
  return {
    id: `rast-${r.id}`,
    name: r.name,
    group: "raster",
    sourceRef: r.id,
    rasterConfig: cfg,
  };
}

/** Daftar raster untuk project (+ raster global project_id null). */
export async function listRasterLayers(projectId: string | null): Promise<AvailableLayer[]> {
  if (!supabase) return [];
  let q = supabase
    .from("raster_layers")
    .select("id,name,storage_path,category,bounds,colormap,min_value,max_value,opacity")
    .order("created_at", { ascending: false });
  // RLS sudah membatasi ke member; filter tambahan agar hanya project aktif + global.
  if (projectId) q = q.or(`project_id.eq.${projectId},project_id.is.null`);
  const { data, error } = await q;
  if (error) {
    console.warn("listRasterLayers:", error.message);
    return [];
  }
  return (data as RasterRow[] ?? []).map(rowToAvailable);
}

export interface InsertRasterMeta {
  projectId: string | null;
  name: string;
  storagePath: string;
  category?: string;
  bounds?: [number, number, number, number];
  colormap?: string;
  minValue?: number;
  maxValue?: number;
  opacity?: number;
}

/** Catat metadata raster (setelah file diunggah ke bucket). Admin-only via RLS. */
export async function insertRasterLayer(meta: InsertRasterMeta): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return { ok: false, error: "Harus login sebagai admin." };

  const { data, error } = await supabase.from("raster_layers").insert({
    project_id: meta.projectId,
    name: meta.name,
    storage_path: meta.storagePath,
    category: meta.category ?? "other",
    bounds: meta.bounds ?? null,
    colormap: meta.colormap ?? null,
    min_value: meta.minValue ?? null,
    max_value: meta.maxValue ?? null,
    opacity: meta.opacity ?? 1,
    created_by: uid,
  }).select("id").single();

  if (error) {
    if (error.code === "42501" || /row-level security|policy/i.test(error.message)) {
      return { ok: false, error: "Ditolak RLS — hanya admin yang boleh menambah raster." };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, id: (data as { id: string })?.id };
}

/**
 * Unggah file COG (GeoTIFF) ke bucket 'rasters' + catat di raster_layers.
 * Memakai sesi admin (RLS admin-write) — TANPA service key. Memvalidasi file
 * benar-benar COG yang bisa dibaca (getCogMetadata) sebelum menyimpan metadata.
 */
export async function uploadRasterCog(params: {
  projectId: string | null;
  file: File;
  name: string;
  category?: string;
  colormap?: string;
  minValue?: number;
  maxValue?: number;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const { file } = params;
  const safe = file.name.replace(/[^\w.-]+/g, "_");
  const path = `${params.projectId ?? "global"}/${Date.now()}-${safe}`;

  // 1. Unggah biner ke Storage (RLS: hanya admin).
  const up = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "image/tiff",
    upsert: false,
  });
  if (up.error) {
    if (/row-level security|Unauthorized|403/i.test(up.error.message)) {
      return { ok: false, error: "Ditolak — hanya admin yang boleh mengunggah raster." };
    }
    return { ok: false, error: up.error.message };
  }

  // 2. Validasi COG + ambil bbox dari file yang sudah terunggah.
  const url = rasterPublicUrl(path);
  let bounds: [number, number, number, number] | undefined;
  try {
    const meta = await getCogMetadata(url);
    if (meta.bbox) bounds = meta.bbox as [number, number, number, number];
  } catch {
    await supabase.storage.from(BUCKET).remove([path]);
    return { ok: false, error: "File bukan COG yang valid (gagal dibaca sebagai Cloud-Optimized GeoTIFF). Konversi dulu: gdal_translate -of COG." };
  }

  // 3. Catat metadata.
  const res = await insertRasterLayer({
    projectId: params.projectId,
    name: params.name,
    storagePath: path,
    category: params.category,
    bounds,
    colormap: params.colormap,
    minValue: params.minValue,
    maxValue: params.maxValue,
  });
  if (!res.ok) {
    await supabase.storage.from(BUCKET).remove([path]);
    return res;
  }
  return res;
}

/** Hapus metadata + file bucket. Admin-only via RLS. */
export async function deleteRasterLayer(id: string, storagePath: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const { error: delErr } = await supabase.from("raster_layers").delete().eq("id", id);
  if (delErr) return { ok: false, error: delErr.message };
  // Best-effort hapus file (jika gagal, metadata sudah hilang).
  await supabase.storage.from(BUCKET).remove([storagePath]);
  return { ok: true };
}

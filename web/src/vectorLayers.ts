import { supabase } from "./supabase";
import type { AvailableLayer } from "./store/mapStore";

// CRUD layer vektor hasil upload (tabel public.vector_layers via PostgREST + RLS).

export interface VectorLayerMeta {
  id: string;
  name: string;
  feature_count: number;
}

export async function listVectorLayers(): Promise<AvailableLayer[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("vector_layers")
    .select("id,name,feature_count")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("listVectorLayers:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: `db-${r.id}`,
    name: r.name,
    group: "db" as const,
    sourceRef: r.id,
  }));
}

export async function getVectorLayerGeojson(id: string): Promise<GeoJSON.FeatureCollection | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("vector_layers").select("geojson").eq("id", id).single();
  if (error) {
    console.warn("getVectorLayerGeojson:", error.message);
    return null;
  }
  return (data?.geojson as GeoJSON.FeatureCollection) ?? null;
}

export async function insertVectorLayer(
  name: string,
  geojson: GeoJSON.FeatureCollection,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return { ok: false, error: "Harus login sebagai admin untuk upload." };

  const { error } = await supabase.from("vector_layers").insert({
    name,
    kind: "boundary",
    feature_count: geojson.features?.length ?? 0,
    geojson,
    created_by: uid,
  });
  if (!error) return { ok: true };

  // Terjemahkan error umum menjadi pesan yang jelas.
  if (error.code === "PGRST205" || /vector_layers/.test(error.message)) {
    return { ok: false, error: "Tabel 'vector_layers' belum ada di database. Jalankan migrasi Supabase (supabase db push) dulu." };
  }
  if (error.code === "42501" || /row-level security|policy/i.test(error.message)) {
    return { ok: false, error: "Ditolak RLS — pastikan Anda login. Insert hanya untuk pengguna terautentikasi." };
  }
  return { ok: false, error: error.message };
}

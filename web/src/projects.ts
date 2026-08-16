import { supabase } from "./supabase";
import type { AvailableLayer } from "./store/mapStore";
import { overlayForName } from "./rasterOverlays";
import type { BlockCollection, Summary } from "./types";

// Client untuk model project (multi-kebun) + share link publik.
export interface Project {
  id: string;
  name: string;
  estate?: string | null;
  description?: string | null;
  share_token: string;
  is_public: boolean;
  n_blocks: number;
}

export interface SharedProject {
  project: { id: string; name: string; estate?: string | null; description?: string | null };
  summary: Summary;
  blocks: BlockCollection;
  /**
   * Metadata layer vektor — TANPA geojson. Total geojson project bisa belasan
   * MB (satu layer garis 9 MB, dua layer titik 12.359 fitur), jadi isinya
   * diambil per layer lewat getSharedLayerGeojson() sesuai kebutuhan.
   */
  vectorLayers?: (AvailableLayer & { nFeatures?: number })[];
  rasterLayers?: AvailableLayer[];
}

const DEFAULT_PROJECT: Project = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Kebun 77 - Kotawaringin",
  estate: "Kebun 77 - Kotawaringin",
  description: "Project utama kebun dan analisis AOI",
  share_token: "kebun77",
  is_public: true,
  n_blocks: 12,
};

export async function listProjects(): Promise<Project[]> {
  if (!supabase) return [DEFAULT_PROJECT];
  const { data, error } = await supabase.rpc("list_projects");
  if (error || !data || data.length === 0) {
    if (error) console.warn("listProjects:", error?.message);
    return [DEFAULT_PROJECT];
  }
  return data as Project[];
}

export async function createProject(
  name: string,
  estate?: string,
  description?: string,
): Promise<{ ok: boolean; project?: Project; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const { data, error } = await supabase.rpc("create_project", {
    p_name: name,
    p_estate: estate ?? null,
    p_description: description ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, project: data as Project };
}

export async function setProjectPublic(id: string, isPublic: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.rpc("set_project_public", { p_project_id: id, p_public: isPublic });
  if (error) {
    console.warn("setProjectPublic:", error.message);
    return false;
  }
  return true;
}

export async function getSharedProject(token: string): Promise<SharedProject | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("shared_project", { p_token: token });
  if (error || !data) {
    if (error) console.warn("getSharedProject:", error.message);
    return null;
  }
  const raw = data as {
    project: { id: string; name: string; estate?: string | null; description?: string | null };
    summary: Summary;
    blocks: BlockCollection;
    vector_layers?: Array<{
      id: string;
      name: string;
      layer_role: string;
      diagnostic_field: string | null;
      period_label: string | null;
      layer_config: { classes?: unknown; weight?: unknown } | null;
      n_features: number | null;
    }>;
    raster_layers?: Array<{
      id: string;
      name: string;
      storage_path: string;
      category: string;
      bounds: [number, number, number, number] | null;
      colormap: string | null;
      min_value: number | null;
      max_value: number | null;
      opacity: number | null;
    }>;
  };

  const result: SharedProject = {
    project: raw.project,
    summary: raw.summary,
    blocks: raw.blocks,
  };

  if (raw.vector_layers && raw.vector_layers.length > 0) {
    result.vectorLayers = raw.vector_layers.map((r) => {
      const isRef = r.layer_role === "reference";
      return {
        id: isRef ? `ref-${r.id}` : `db-${r.id}`,
        name: r.name,
        group: "db" as const,
        sourceRef: r.id,
        layerRole: r.layer_role,
        diagnosticField: r.diagnostic_field ?? undefined,
        periodLabel: r.period_label ?? undefined,
        layerConfig: r.layer_config as never ?? undefined,
        nFeatures: r.n_features ?? undefined,
      };
    });
  }

  if (raw.raster_layers && raw.raster_layers.length > 0) {
    // Database menentukan raster mana milik project; yang digambar selalu
    // overlay PNG dari manifest. Raster yang belum diproses skrip dilewati.
    result.rasterLayers = raw.raster_layers
      .map((r) => overlayForName(r.name))
      .filter((x): x is AvailableLayer => Boolean(x));
  }

  // Tidak ada lagi fallback kueri tabel langsung: pengunjung share tidak login,
  // sehingga RLS selalu menolaknya dengan 401 dan halaman jadi tampak rusak.
  // shared_project() (SECURITY DEFINER) adalah satu-satunya jalur yang sah.

  return result;
}

/** Import FeatureCollection boundary sebagai blok produksi milik project. */
export async function importProjectBlocks(
  projectId: string,
  geojson: GeoJSON.FeatureCollection,
  idField?: string,
): Promise<{ ok: boolean; imported?: number; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const { data, error } = await supabase.rpc("import_project_blocks", {
    p_project_id: projectId,
    p_geojson: geojson,
    p_id_field: idField ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, imported: (data as { imported: number })?.imported ?? 0 };
}

/** Bangun URL share publik untuk sebuah token. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/?share=${token}`;
}

/**
 * Ambil geojson satu layer untuk pengunjung share publik.
 *
 * Token divalidasi ulang di sisi database dan layer wajib milik project yang
 * dibuka token itu, jadi mengetahui satu token tidak memberi akses ke layer
 * project lain.
 */
export async function getSharedLayerGeojson(
  token: string,
  layerId: string,
): Promise<GeoJSON.FeatureCollection | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("shared_layer_geojson", {
    p_token: token,
    p_layer_id: layerId,
  });
  if (error) {
    console.warn("getSharedLayerGeojson:", error.message);
    return null;
  }
  return (data as GeoJSON.FeatureCollection) ?? null;
}

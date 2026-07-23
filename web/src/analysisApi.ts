import { supabase } from "./supabase";
import type {
  AvailableLayer, LayerClass,
  AnalysisResult, BlockAnalysisSummary,
  TableLayerConfig, TableRow,
} from "./store/mapStore";

// ── API client untuk Layer Management System ─────────────────────────────────
// Semua operasi spatial berat (intersect/clip/aggregate) dijalankan
// di server via PostGIS RPC — bukan di browser.

// ── Reference Layers ─────────────────────────────────────────────────────────

export interface RefLayerMeta {
  id: string;
  name: string;
  layerRole: string;
  diagnosticField: string | null;
  periodLabel: string | null;
  periodDate: string | null;
  layerGroup: string | null;
  layerConfig: { classes?: LayerClass[]; weight?: number } | null;
  featureCount: number;
  projectId: string | null;
  createdAt: string;
}

/** List semua reference layers (dengan metadata lengkap) */
export async function listReferenceLayers(projectId?: string): Promise<AvailableLayer[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("list_reference_layers", {
    p_project_id: projectId ?? null,
  });
  if (error) { console.warn("listReferenceLayers:", error.message); return []; }

  return ((data as RefLayerMeta[]) ?? []).map((r) => ({
    id:             `ref-${r.id}`,
    name:           r.name,
    group:          "db" as const,
    sourceRef:      r.id,
    layerRole:      r.layerRole,
    diagnosticField: r.diagnosticField ?? undefined,
    periodLabel:    r.periodLabel ?? undefined,
    layerGroup:     r.layerGroup ?? undefined,
    layerConfig:    r.layerConfig ?? undefined,
  }));
}

/** Update metadata reference layer (diagnostic_field, classes, weight, period) */
export async function updateRefLayerMeta(
  id: string,
  patch: {
    name?: string;
    diagnosticField?: string;
    layerConfig?: { classes: LayerClass[]; weight: number };
    periodLabel?: string;
    periodDate?: string;
    layerGroup?: string;
  },
): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from("vector_layers")
    .update({
      ...(patch.name            !== undefined ? { name: patch.name } : {}),
      ...(patch.diagnosticField !== undefined ? { diagnostic_field: patch.diagnosticField } : {}),
      ...(patch.layerConfig     !== undefined ? { layer_config: patch.layerConfig } : {}),
      ...(patch.periodLabel     !== undefined ? { period_label: patch.periodLabel } : {}),
      ...(patch.periodDate      !== undefined ? { period_date: patch.periodDate } : {}),
      ...(patch.layerGroup      !== undefined ? { layer_group: patch.layerGroup } : {}),
    })
    .eq("id", id);
  if (error) { console.warn("updateRefLayerMeta:", error.message); return false; }
  return true;
}

/** Upload reference layer ke DB dengan metadata lengkap */
export async function insertRefLayer(opts: {
  name: string;
  geojson: GeoJSON.FeatureCollection;
  diagnosticField?: string;
  layerConfig?: { classes: LayerClass[]; weight: number };
  periodLabel?: string;
  periodDate?: string;
  layerGroup?: string;
  projectId?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return { ok: false, error: "Harus login untuk upload layer." };

  const { data, error } = await supabase
    .from("vector_layers")
    .insert({
      name: opts.name,
      kind: "boundary",
      layer_role: "reference",
      feature_count: opts.geojson.features?.length ?? 0,
      geojson: opts.geojson,
      diagnostic_field: opts.diagnosticField ?? null,
      layer_config: opts.layerConfig ?? null,
      period_label: opts.periodLabel ?? null,
      period_date: opts.periodDate ?? null,
      layer_group: opts.layerGroup ?? null,
      project_id: opts.projectId ?? null,
      created_by: uid,
    })
    .select("id")
    .single();

  if (error) {
    if (/PGRST205/.test(error.code) || /vector_layers/.test(error.message))
      return { ok: false, error: "Tabel belum ada. Jalankan migrasi Supabase." };
    if (error.code === "42501")
      return { ok: false, error: "Ditolak RLS - pastikan Anda login." };
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data?.id };
}

// ── Temporal Layers ───────────────────────────────────────────────────────────

export interface TemporalSnapshot {
  id: string;
  name: string;
  periodLabel: string;
  periodDate: string | null;
  diagnosticField: string | null;
  layerConfig: { classes?: LayerClass[]; weight?: number } | null;
  featureCount: number;
}

/** List semua snapshot temporal dari satu layer_group */
export async function listTemporalLayers(layerGroup: string): Promise<TemporalSnapshot[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("list_temporal_layers", {
    p_layer_group: layerGroup,
  });
  if (error) { console.warn("listTemporalLayers:", error.message); return []; }

  return ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
    id:             String(r.id),
    name:           String(r.name),
    periodLabel:    String(r.period_label ?? ""),
    periodDate:     r.period_date ? String(r.period_date) : null,
    diagnosticField: r.diagnostic_field ? String(r.diagnostic_field) : null,
    layerConfig:    (r.layer_config as { classes?: LayerClass[]; weight?: number }) ?? null,
    featureCount:   Number(r.feature_count ?? 0),
  }));
}

/** Ambil GeoJSON untuk satu temporal snapshot (dari vector_layers) */
export async function getTemporalSnapshotGeojson(id: string): Promise<GeoJSON.FeatureCollection | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("vector_layers")
    .select("geojson")
    .eq("id", id)
    .single();
  if (error) { console.warn("getTemporalSnapshotGeojson:", error.message); return null; }
  return (data?.geojson as GeoJSON.FeatureCollection) ?? null;
}

// ── Analysis Engine ───────────────────────────────────────────────────────────

export interface RunAnalysisPayload {
  blockGeojson: GeoJSON.FeatureCollection;
  refLayers: Array<{
    id: string;
    name: string;
    geojson: GeoJSON.FeatureCollection;
    diagnosticField: string;
    classes: LayerClass[];
    weight: number;
  }>;
  projectId?: string;
}

export interface RunAnalysisResponse {
  ok: boolean;
  result?: AnalysisResult;
  error?: string;
}

/** Jalankan analisis intersect di server (PostGIS) */
export async function runLayerAnalysis(payload: RunAnalysisPayload): Promise<RunAnalysisResponse> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };

  const { data, error } = await supabase.rpc("run_layer_analysis", {
    p_block_geojson: payload.blockGeojson,
    p_ref_layers: payload.refLayers.map((l) => ({
      id: l.id,
      name: l.name,
      geojson: l.geojson,
      diagnostic_field: l.diagnosticField,
      classes: l.classes,
      weight: l.weight,
    })),
    p_project_id: payload.projectId ?? null,
  });

  if (error) { return { ok: false, error: error.message }; }

  const raw = data as {
    zones: GeoJSON.FeatureCollection;
    block_summaries: BlockAnalysisSummary[];
    zone_count: number;
    block_count: number;
  };

  const result: AnalysisResult = {
    timestamp: new Date().toISOString(),
    refLayerIds: payload.refLayers.map((l) => l.id),
    blockSummaries: raw.block_summaries,
    zonesGeojson: raw.zones,
    zoneCount: raw.zone_count,
    saved: false,
  };

  return { ok: true, result };
}

/** Simpan hasil analisis ke DB (analysis_results + vector_layer baru) */
export async function saveAnalysisResult(opts: {
  projectId: string;
  name: string;
  blockLayerId: string;
  refLayerIds: string[];
  result: AnalysisResult;
  tableLayerId?: string;
}): Promise<{ ok: boolean; resultId?: string; zoneLayerId?: string; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };

  const { data, error } = await supabase.rpc("save_analysis_result", {
    p_project_id:       opts.projectId,
    p_name:             opts.name,
    p_block_layer_id:   opts.blockLayerId,
    p_ref_layer_ids:    opts.refLayerIds,
    p_block_summaries:  opts.result.blockSummaries,
    p_zones_geojson:    opts.result.zonesGeojson,
    p_table_layer_id:   opts.tableLayerId ?? null,
  });

  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    resultId: (data as { result_id: string }).result_id,
    zoneLayerId: (data as { zone_layer_id: string }).zone_layer_id,
  };
}

// ── Production Data (Table Layer) ─────────────────────────────────────────────

export interface ProductionDataMeta {
  id: string;
  name: string;
  joinField: string;
  valueFields: string[];
  rowCount: number;
  createdAt: string;
}

/** Simpan Table Layer (Excel/CSV) ke Supabase */
export async function saveProductionData(
  projectId: string,
  config: TableLayerConfig,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };

  const { data, error } = await supabase.rpc("upsert_production_data", {
    p_project_id:   projectId,
    p_name:         config.name,
    p_join_field:   config.joinField,
    p_value_fields: config.valueFields,
    p_rows:         config.rows as TableRow[],
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data as string };
}

/** Ambil daftar production_data untuk project */
export async function listProductionData(projectId: string): Promise<ProductionDataMeta[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("production_data")
    .select("id,name,join_field,value_fields,row_count,created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) { console.warn("listProductionData:", error.message); return []; }
  return (data ?? []).map((r) => ({
    id: r.id, name: r.name, joinField: r.join_field,
    valueFields: r.value_fields, rowCount: r.row_count, createdAt: r.created_at,
  }));
}

/** Ambil baris production_data satu record */
export async function getProductionDataRows(id: string): Promise<TableRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("production_data")
    .select("rows,join_field,value_fields")
    .eq("id", id)
    .single();
  if (error) { console.warn("getProductionDataRows:", error.message); return []; }
  return (data?.rows as TableRow[]) ?? [];
}

// ── Auto-detect classes dari GeoJSON field ────────────────────────────────────
/** Deteksi kelas diskrit dari satu field di FeatureCollection */
export function detectClasses(
  geojson: GeoJSON.FeatureCollection,
  field: string,
): LayerClass[] {
  const valueSet = new Set<string>();
  for (const f of geojson.features) {
    const v = (f.properties as Record<string, unknown>)?.[field];
    if (v != null && String(v).trim() !== "") valueSet.add(String(v));
  }

  // Palet warna default per kelas (max 10)
  const palette = [
    "#C0392B", "#D97706", "#CA8A04", "#5FA83F",
    "#0891b2", "#6D28D9", "#DB2777", "#059669",
    "#7C3AED", "#2563EB",
  ];

  return [...valueSet].slice(0, 10).map((v, i) => ({
    value: v,
    label: v,
    color: palette[i % palette.length],
    isProblematic: false,
  }));
}

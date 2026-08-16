// Tipe data selaras struktur output RPC Supabase (blocks_geojson dll.)

// "no_data" bukan tingkat keparahan, melainkan ketiadaan analisis. Dibedakan
// dari "normal" supaya blok yang belum pernah diperiksa tidak dilaporkan sehat.
export type PriorityLevel = "critical" | "warning" | "monitor" | "normal";
export type PriorityBucket = PriorityLevel | "no_data";

// Bentuk yang benar-benar ditulis overlay engine (overlay.py INTERVENTION_MATRIX):
// {intervention, label, priority, lag_weeks_min, lag_weeks_max, literature}.
// `type` & `effort_score` hanya ada pada data sample lama, jadi opsional.
export interface Intervention {
  intervention?: string;
  type?: string;
  label: string;
  priority: number;
  lag_weeks_min: number;
  lag_weeks_max: number;
  effort_score?: number;
  literature: string;
}

export interface BlockProperties {
  block_id: string;
  estate: string;
  area_ha: number;
  planting_year: number;
  age_years: number;
  variety: string;
  last_updated: string | null;
  ndvi_value: number;
  evi_value: number;
  lai_value: number;
  lst_celsius: number;
  rainfall_30d_mm: number;
  rainfall_90d_mm: number;
  soil_ph: number;
  soil_soc: number;
  // Ditambahkan migrasi 20260711000000 — hasil Track C yang sebelumnya tak
  // pernah sampai ke UI. Opsional: blok tanpa data pipeline tetap valid.
  temp_2m_mean?: number | null;
  et_stress_ratio?: number | null;
  soil_moisture?: number | null;
  tbs_ton_ha?: number | null;
  soil_clay?: number | null;
  soil_sand?: number | null;
  soil_cec?: number | null;
  soil_nitrogen?: number | null;
  /** Tanggal observasi EO terakhir (lintas source). */
  eo_last_obs?: string | null;
  /** Daftar source yang berkontribusi ke blok ini (mis. open-meteo, sentinel-2-stac). */
  eo_sources?: string[] | null;
  conditions: string[];
  n_conditions: number;
  severity_score: number;
  priority_level: PriorityLevel | null;   // null = belum pernah dianalisis
  has_conditions?: boolean;
  interventions: Intervention[];
  n_interventions: number;
  yield_baseline_ton_ha: number;
  yield_predicted_after_intervention: number;
  regression_r2: number;
  composite_score: number;
  intervention_rank: number;
}

export interface BlockFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: BlockProperties;
}

export interface BlockCollection {
  type: "FeatureCollection";
  features: BlockFeature[];
}

export interface Summary {
  tenant_id: string;
  n_blocks: number;
  total_area_ha: number;
  by_priority: Record<PriorityBucket, number>;
  n_analyzed?: number;
  n_need_intervention: number;
  mean_regression_r2: number | null;      // null bila belum ada regresi
  last_updated: string | null;
  data_source: string;
}

export interface TimeseriesPoint {
  date: string;
  source?: string | null;
  ndvi: number | null;
  evi: number | null;
  lai?: number | null;
  fpar?: number | null;
  lst_celsius?: number | null;
  temp_2m_mean?: number | null;
  rainfall_30d_mm: number | null;
  rainfall_90d_mm?: number | null;
  soil_moisture?: number | null;
  et_stress_ratio?: number | null;
  tbs_ton_ha: number | null;
}

export interface Timeseries {
  block_id: string;
  series: TimeseriesPoint[];
}

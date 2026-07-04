// Tipe data selaras struktur output API (api/sample_data.py)

export type PriorityLevel = "critical" | "warning" | "monitor" | "normal";

export interface Intervention {
  type: string;
  label: string;
  priority: number;
  lag_weeks_min: number;
  lag_weeks_max: number;
  effort_score: number;
  literature: string;
}

export interface BlockProperties {
  block_id: string;
  estate: string;
  area_ha: number;
  planting_year: number;
  age_years: number;
  variety: string;
  last_updated: string;
  ndvi_value: number;
  evi_value: number;
  lai_value: number;
  lst_celsius: number;
  rainfall_30d_mm: number;
  rainfall_90d_mm: number;
  soil_ph: number;
  soil_soc: number;
  conditions: string[];
  n_conditions: number;
  severity_score: number;
  priority_level: PriorityLevel;
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
  by_priority: Record<PriorityLevel, number>;
  n_need_intervention: number;
  mean_regression_r2: number;
  last_updated: string;
  data_source: string;
}

export interface TimeseriesPoint {
  date: string;
  ndvi: number;
  evi: number;
  rainfall_30d_mm: number;
  tbs_ton_ha: number;
}

export interface Timeseries {
  block_id: string;
  series: TimeseriesPoint[];
}

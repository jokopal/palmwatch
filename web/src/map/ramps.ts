import type maplibregl from "maplibre-gl";
import type { InsetLayerKey } from "../store/mapStore";

// Choropleth per-variabel untuk inset: warnai poligon blok berdasar atribut EO
// (ndvi_value, lst_celsius, dll.) memakai interpolasi warna. Membuat pemilih
// layer inset benar-benar berfungsi tanpa raster GEE.

interface RampDef {
  field: string;
  stops: [number, string][];
  label: string;
}

export const RAMPS: Record<InsetLayerKey, RampDef> = {
  ndvi: { field: "ndvi_value", label: "NDVI", stops: [[0.25, "#a16207"], [0.45, "#facc15"], [0.65, "#84cc16"], [0.8, "#166534"]] },
  evi: { field: "evi_value", label: "EVI", stops: [[0.15, "#a16207"], [0.3, "#facc15"], [0.45, "#5FA83F"]] },
  lst: { field: "lst_celsius", label: "LST (°C)", stops: [[28, "#2563eb"], [33, "#facc15"], [38, "#dc2626"]] },
  rain: { field: "rainfall_30d_mm", label: "Rainfall 30d (mm)", stops: [[60, "#dc2626"], [150, "#facc15"], [280, "#2563eb"]] },
  twi: { field: "severity_score", label: "Severity", stops: [[0, "#5FA83F"], [3, "#facc15"], [6, "#dc2626"]] },
};

export function rampColorExpr(key: InsetLayerKey): maplibregl.ExpressionSpecification {
  const r = RAMPS[key];
  // Ekspresi MapLibre bersarang sulit di-type; pakai any[] lalu cast.
  const expr: unknown[] = [
    "interpolate", ["linear"], ["coalesce", ["get", r.field], r.stops[0][0]],
  ];
  for (const [v, c] of r.stops) expr.push(v, c);
  return expr as unknown as maplibregl.ExpressionSpecification;
}

export function rampLegend(key: InsetLayerKey): { label: string; stops: [number, string][] } {
  return { label: RAMPS[key].label, stops: RAMPS[key].stops };
}

import type maplibregl from "maplibre-gl";
import type { Symbology } from "../store/mapStore";

// Bangun ekspresi fill-color MapLibre dari definisi simbologi.
export function fillColorExpr(sym: Symbology): maplibregl.ExpressionSpecification | string {
  if (sym.mode === "single" || !sym.categoryField || sym.categories.length === 0) {
    return sym.fill;
  }
  const match: (string | string[])[] = ["match", ["get", sym.categoryField]];
  for (const c of sym.categories) {
    match.push(c.value, c.color);
  }
  match.push(sym.fill); // fallback
  return match as unknown as maplibregl.ExpressionSpecification;
}

export interface LegendEntry {
  color: string;
  label: string;
}

/** Entri legenda untuk satu layer sesuai simbologinya. */
export function legendEntries(sym: Symbology, layerName: string): LegendEntry[] {
  if (sym.mode === "categorized" && sym.categories.length > 0) {
    return sym.categories.map((c) => ({ color: c.color, label: c.label }));
  }
  return [{ color: sym.fill, label: layerName }];
}

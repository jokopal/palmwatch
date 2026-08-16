import type maplibregl from "maplibre-gl";
import type { Symbology } from "../store/mapStore";

/**
 * Nilai kategori khusus untuk fitur yang field kategorinya kosong/null.
 *
 * MapLibre `match` tidak bisa mencocokkan null: fitur tanpa nilai selalu jatuh
 * ke warna fallback. Tanpa penanganan ini, blok yang belum pernah dianalisis
 * (priority_level = null) diwarnai sama seperti blok sehat — persis klaim yang
 * tidak boleh dibuat. Layer mana pun bisa mendefinisikan kategori bernilai
 * "no_data" untuk memberi warna tersendiri pada ketiadaan data.
 */
export const NO_DATA_VALUE = "no_data";

// Bangun ekspresi fill-color MapLibre dari definisi simbologi.
export function fillColorExpr(sym: Symbology): maplibregl.ExpressionSpecification | string {
  if (sym.mode === "single" || !sym.categoryField || sym.categories.length === 0) {
    return sym.fill;
  }
  // coalesce adalah idiom MapLibre untuk properti yang hilang atau null.
  const input = ["coalesce", ["get", sym.categoryField], NO_DATA_VALUE];
  const match: unknown[] = ["match", input];
  for (const c of sym.categories) {
    match.push(c.value, c.color);
  }
  match.push(sym.fill); // fallback untuk nilai yang tak dikenal
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

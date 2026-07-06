import { useSyncExternalStore } from "react";
import { DEFAULT_BASEMAP, type BasemapId } from "../map/basemaps";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "../api";

// ── Store peta global (tanpa dependency eksternal) ───────────────────────────
// Sumber kebenaran tunggal untuk basemap, inset, layer aktif, dan simbologi.
// Komponen React memakai hook `useMapStore`; MapLibre (imperatif) memakai
// `subscribe`/`getState`.

export type InsetLayerKey = "ndvi" | "lst" | "rain" | "twi" | "evi";

export interface InsetConfig {
  id: string;
  layer: InsetLayerKey;
}

// ── Simbologi (mirip QGIS/ArcGIS) ────────────────────────────────────────────
export interface SymbologyCategory {
  value: string;
  color: string;
  label: string;
}

export interface Symbology {
  mode: "single" | "categorized";
  fill: string;
  fillOpacity: number; // 0..1
  stroke: string;
  strokeWidth: number;
  categoryField?: string; // untuk categorized (mis. "priority_level")
  categories: SymbologyCategory[];
}

export type LayerKind = "blocks" | "gee" | "db";

export interface ActiveLayer {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  symbology: Symbology;
  sourceRef?: string; // id sumber (gee key / vector_layers id)
  data?: GeoJSON.FeatureCollection; // geometri (untuk layer DB yang di-render)
}

export interface AvailableLayer {
  id: string;
  name: string;
  group: "gee" | "db";
  sourceRef?: string;
}

export interface MapState {
  basemap: BasemapId;
  insetsEnabled: boolean;
  insets: InsetConfig[]; // maks 3
  activeLayers: ActiveLayer[];
  selectedLayerId: string | null;
  dbLayers: AvailableLayer[]; // layer hasil upload (dari DB)
  leftTab: "layers" | "upload";
  threeD: boolean; // mode 3D (terrain + ekstrusi)
}

const MAX_INSETS = 3;

// Simbologi default untuk layer blok = kategorikal berdasar priority_level.
function defaultBlocksSymbology(): Symbology {
  return {
    mode: "categorized",
    fill: "#3b82f6",
    fillOpacity: 0.65,
    stroke: "#ffffff",
    strokeWidth: 1,
    categoryField: "priority_level",
    categories: (["critical", "warning", "monitor", "normal"] as const).map((k) => ({
      value: k,
      color: PRIORITY_COLOR[k],
      label: PRIORITY_LABEL[k],
    })),
  };
}

function defaultGeeSymbology(color: string): Symbology {
  return { mode: "single", fill: color, fillOpacity: 0.55, stroke: "#334155", strokeWidth: 0.5, categories: [] };
}

// Katalog layer GEE yang tersedia (statis; sumber raster/analitik).
export const GEE_AVAILABLE: AvailableLayer[] = [
  { id: "gee-ndvi", name: "NDVI (Sentinel-2)", group: "gee", sourceRef: "ndvi" },
  { id: "gee-evi", name: "EVI (Sentinel-2)", group: "gee", sourceRef: "evi" },
  { id: "gee-lst", name: "Land Surface Temp (MODIS)", group: "gee", sourceRef: "lst" },
  { id: "gee-rain", name: "Rainfall (CHIRPS)", group: "gee", sourceRef: "rain" },
  { id: "gee-soil", name: "Soil Moisture (SMAP)", group: "gee", sourceRef: "soil_moisture" },
  { id: "gee-et", name: "Evapotranspiration (MOD16)", group: "gee", sourceRef: "et" },
];

const GEE_COLORS: Record<string, string> = {
  ndvi: "#16a34a", evi: "#65a30d", lst: "#dc2626", rain: "#2563eb", soil_moisture: "#0891b2", et: "#7c3aed",
};

let state: MapState = {
  basemap: DEFAULT_BASEMAP,
  insetsEnabled: true,
  insets: [
    { id: "inset-1", layer: "ndvi" },
    { id: "inset-2", layer: "rain" },
  ],
  activeLayers: [
    {
      id: "layer-blocks",
      name: "Harvest Blocks",
      kind: "blocks",
      visible: true,
      symbology: defaultBlocksSymbology(),
    },
  ],
  selectedLayerId: "layer-blocks",
  dbLayers: [],
  leftTab: "layers",
  threeD: false,
};

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function set(patch: Partial<MapState>) {
  state = { ...state, ...patch };
  emit();
}

export const mapStore = {
  getState: (): MapState => state,
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  // Basemap
  setBasemap: (basemap: BasemapId) => set({ basemap }),

  // Inset
  setInsetsEnabled: (insetsEnabled: boolean) => set({ insetsEnabled }),
  setInsetLayer: (id: string, layer: InsetLayerKey) =>
    set({ insets: state.insets.map((i) => (i.id === id ? { ...i, layer } : i)) }),
  addInset: () => {
    if (state.insets.length >= MAX_INSETS) return;
    set({ insets: [...state.insets, { id: `inset-${Date.now()}`, layer: "lst" }] });
  },
  removeInset: (id: string) => set({ insets: state.insets.filter((i) => i.id !== id) }),

  // Layer aktif
  selectLayer: (selectedLayerId: string | null) => set({ selectedLayerId }),
  toggleLayerVisible: (id: string) =>
    set({ activeLayers: state.activeLayers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) }),
  removeLayer: (id: string) =>
    set({
      activeLayers: state.activeLayers.filter((l) => l.id !== id),
      selectedLayerId: state.selectedLayerId === id ? null : state.selectedLayerId,
    }),
  addAvailableLayer: (a: AvailableLayer) => {
    // Hindari duplikat.
    if (state.activeLayers.some((l) => l.sourceRef === a.sourceRef && l.kind !== "blocks")) return;
    const id = `layer-${a.id}-${Date.now()}`;
    const kind: LayerKind = a.group === "gee" ? "gee" : "db";
    const color = a.group === "gee" ? GEE_COLORS[a.sourceRef ?? ""] ?? "#0ea5e9" : "#f59e0b";
    set({
      activeLayers: [
        ...state.activeLayers,
        { id, name: a.name, kind, visible: true, symbology: defaultGeeSymbology(color), sourceRef: a.sourceRef },
      ],
      selectedLayerId: id,
    });
  },
  addDbLayer: (a: AvailableLayer, geojson: GeoJSON.FeatureCollection) => {
    if (state.activeLayers.some((l) => l.sourceRef === a.sourceRef && l.kind === "db")) return;
    const id = `layer-${a.id}-${Date.now()}`;
    set({
      activeLayers: [
        ...state.activeLayers,
        {
          id, name: a.name, kind: "db", visible: true, sourceRef: a.sourceRef,
          symbology: defaultGeeSymbology("#f59e0b"), data: geojson,
        },
      ],
      selectedLayerId: id,
    });
  },
  updateSymbology: (id: string, patch: Partial<Symbology>) =>
    set({
      activeLayers: state.activeLayers.map((l) =>
        l.id === id ? { ...l, symbology: { ...l.symbology, ...patch } } : l,
      ),
    }),
  reorderLayer: (id: string, dir: -1 | 1) => {
    const arr = [...state.activeLayers];
    const i = arr.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set({ activeLayers: arr });
  },

  // DB layers (hasil upload)
  setDbLayers: (dbLayers: AvailableLayer[]) => set({ dbLayers }),

  // Tab panel kiri
  setLeftTab: (leftTab: "layers" | "upload") => set({ leftTab }),

  // Mode 3D
  setThreeD: (threeD: boolean) => set({ threeD }),

  MAX_INSETS,
};

// Hook dev untuk debugging/verifikasi di konsol browser (hanya mode dev).
if (import.meta.env.DEV) {
  (window as unknown as { __mapStore?: typeof mapStore }).__mapStore = mapStore;
}

/** Hook React dengan selektor (kembalikan nilai stabil untuk hindari loop). */
export function useMapStore<T>(selector: (s: MapState) => T): T {
  return useSyncExternalStore(
    mapStore.subscribe,
    () => selector(state),
    () => selector(state),
  );
}

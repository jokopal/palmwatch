import { useSyncExternalStore } from "react";
import { DEFAULT_BASEMAP, type BasemapId } from "../map/basemaps";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "../api";
import { zoomToLayer } from "../map/zoomToLayer";

// ── Store peta global (tanpa dependency eksternal) ───────────────────────────
// Sumber kebenaran tunggal untuk basemap, inset, layer aktif, simbologi,
// table layer, dan hasil analisis intersect.

export type InsetLayerKey = "ndvi" | "lst" | "rain" | "twi" | "evi";

export interface InsetConfig {
  id: string;
  layer: InsetLayerKey;
}

// ── Simbologi ─────────────────────────────────────────────────────────────────
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
  categoryField?: string;
  categories: SymbologyCategory[];
  // Label
  labelField?: string;
  labelVisible?: boolean;
  labelFontSize?: number;  // px
  labelColor?: string;
}

// ── Layer Kind ────────────────────────────────────────────────────────────────
// blocks   = layer utama AOI (singleton, tidak bisa dihapus)
// reference = layer referensi multi, di-clip ke AOI, untuk analisis diagnostik
// gee      = raster EO (GEE) — overlay visual saja
// db       = vektor generik dari DB (tidak punya diagnostic config)
// raster   = COG mandiri (DEM/tanah/TWI) dari Supabase Storage — overlay raster
export type LayerKind = "blocks" | "reference" | "gee" | "db" | "raster";

// ── Raster Layer (COG) config ─────────────────────────────────────────────────
export interface RasterLayerConfig {
  url: string;                                   // URL publik ke file COG
  colormap?: string;                             // nama skema warna geomatico (mis. "BrewerSpectral9")
  minValue?: number;
  maxValue?: number;
  bounds?: [number, number, number, number];     // [minx,miny,maxx,maxy] EPSG:4326
  category?: string;                             // dem|soil|rainfall|twi|ndvi|other
  opacity: number;                               // 0..1
}

// ── Reference Layer: kelas diskrit untuk analisis ─────────────────────────────
export interface LayerClass {
  value: string;         // nilai field (mis. "rendah")
  label: string;         // label tampilan (mis. "NDVI Rendah")
  color: string;         // warna polygon
  isProblematic: boolean; // kelas ini = kondisi bermasalah?
}

export interface ReferenceLayerConfig {
  diagnosticField: string;   // field yang jadi dasar klasifikasi
  classes: LayerClass[];     // kelas diskrit (auto-detect dari data atau manual)
  weight: number;            // 0..1, bobot dalam scoring gabungan
  periodLabel?: string;      // label periode untuk temporal (mis. "2024-03")
  periodDate?: string;       // tanggal ISO untuk sorting
  layerGroup?: string;       // ID grup temporal (semua snapshot layer sama)
  dbLayerId?: string;        // UUID di vector_layers
}

// ── Table Layer: data produksi lapangan ──────────────────────────────────────
export interface TableRow {
  [key: string]: string | number | null;
}

export interface TableLayerConfig {
  id?: string;               // UUID di production_data (jika sudah disimpan)
  name: string;
  joinField: string;         // field kunci join ke block_id
  valueFields: string[];     // kolom produksi yang ditampilkan
  rows: TableRow[];
}

// ── Hasil Analisis ────────────────────────────────────────────────────────────
export interface AnalysisZoneProperties {
  zone_id: number;
  block_id: string;
  ref_layer_id: string;
  ref_layer_name: string;
  class_value: string;
  diagnostic_field: string;
  is_problematic: boolean;
  area_ha: number;
  weight: number;
}

export interface BlockAnalysisSummary {
  block_id: string;
  total_area_ha: number;
  problematic_ha: number;
  problematic_pct: number;
  dominant_diagnosis: string; // "Kritis" | "Peringatan" | "Pantau" | "Normal"
  zone_count: number;
  zones: AnalysisZoneProperties[];
}

export interface AnalysisResult {
  id?: string;              // UUID setelah disimpan ke DB
  resultLayerId?: string;   // vector_layer id untuk zona yang disimpan
  timestamp: string;
  refLayerIds: string[];
  blockSummaries: BlockAnalysisSummary[];
  zonesGeojson: GeoJSON.FeatureCollection;
  zoneCount: number;
  saved: boolean;
}

// ── Urutan tumpukan (z-order) ────────────────────────────────────────────────
// KONVENSI: `activeLayers[0]` = paling ATAS (seperti daftar layer QGIS), layer
// yang baru ditambahkan masuk di indeks 0. MapView menegakkan urutan ini ke
// MapLibre lewat moveLayer() — sebelumnya urutan peta = urutan penambahan
// sehingga tombol naik/turun tidak berefek apa pun.
//
// Raster COG SELALU digambar di bawah seluruh layer vektor, apa pun posisinya
// di daftar. Alasannya praktis: satu DEM full-extent akan menutupi seluruh
// poligon dan membuat pengguna mengira layer vektornya hilang.

// ── Active Layer ──────────────────────────────────────────────────────────────
export interface ActiveLayer {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  locked?: boolean;
  symbology: Symbology;
  sourceRef?: string;
  data?: GeoJSON.FeatureCollection;
  // Reference layer config (hanya untuk kind === "reference")
  referenceConfig?: ReferenceLayerConfig;
  // Raster config (hanya untuk kind === "raster")
  rasterConfig?: RasterLayerConfig;
}

export interface AvailableLayer {
  id: string;
  name: string;
  group: "gee" | "db" | "raster";
  sourceRef?: string;
  // Metadata dari DB
  layerRole?: string;
  diagnosticField?: string;
  periodLabel?: string;
  layerGroup?: string;
  layerConfig?: { classes?: LayerClass[]; weight?: number };
  // Metadata raster (group === "raster")
  rasterConfig?: RasterLayerConfig;
}

// ── Map State ─────────────────────────────────────────────────────────────────
export interface MapState {
  basemap: BasemapId;
  insetsEnabled: boolean;
  insets: InsetConfig[];
  activeLayers: ActiveLayer[];
  selectedLayerId: string | null;
  dbLayers: AvailableLayer[];
  leftTab: "layers" | "upload";
  threeD: boolean;
  // Baru:
  tableLayer: TableLayerConfig | null;
  analysisResult: AnalysisResult | null;
  analysisRunning: boolean;
  temporalGroupId: string | null;  // layer_group dipilih untuk temporal
  rasterLayers: AvailableLayer[];  // katalog raster COG dari DB (group === "raster")
  clipRasterToBoundary: boolean;   // clip semua raster COG ke batas blok (performa + fokus AOI)
  /**
   * Kegagalan render per layer (id layer -> pesan). Diisi MapView saat MapLibre
   * melaporkan error pada source milik kita (COG rusak, 404, CORS, di luar AOI).
   * Tanpa ini, layer yang gagal hanya "tidak terlihat" tanpa penjelasan apa pun.
   */
  layerErrors: Record<string, string>;
}

const MAX_INSETS = 3;

// ── Default symbologies ───────────────────────────────────────────────────────
function defaultBlocksSymbology(): Symbology {
  return {
    mode: "categorized",
    fill: "#1D4E2C",
    fillOpacity: 0.65,
    stroke: "#ffffff",
    strokeWidth: 1,
    categoryField: "priority_level",
    categories: (["critical", "warning", "monitor", "normal"] as const).map((k) => ({
      value: k,
      color: PRIORITY_COLOR[k],
      label: PRIORITY_LABEL[k],
    })),
    labelField: "block_id",
    labelVisible: true,
    labelFontSize: 10,
    labelColor: "#ffffff",
  };
}

// PENTING: `categoryField` WAJIB diisi bila mode "categorized".
// fillColorExpr() jatuh ke warna tunggal bila categoryField kosong — dulu itu
// membuat SEMUA reference layer tampil hijau polos meski kelasnya sudah
// dikonfigurasi, dan editor kategori tersembunyi di panel properti.
function defaultReferenceSymbology(classes: LayerClass[], diagnosticField?: string): Symbology {
  if (classes.length > 0 && diagnosticField) {
    return {
      mode: "categorized",
      fill: "#5FA83F",
      fillOpacity: 0.55,
      stroke: "#1D4E2C",
      strokeWidth: 0.8,
      categoryField: diagnosticField,
      categories: classes.map((c) => ({ value: c.value, color: c.color, label: c.label })),
      labelVisible: false,
      labelFontSize: 9,
      labelColor: "#14361F",
    };
  }
  return defaultGeeSymbology("#5FA83F");
}

/** Turunkan kategori simbologi dari kelas diagnostik reference layer. */
function symbologyFromClasses(
  base: Symbology,
  classes: LayerClass[],
  diagnosticField?: string,
): Symbology {
  if (classes.length === 0 || !diagnosticField) return base;
  return {
    ...base,
    mode: "categorized",
    categoryField: diagnosticField,
    categories: classes.map((c) => ({ value: c.value, color: c.color, label: c.label })),
  };
}

function defaultGeeSymbology(color: string): Symbology {
  return {
    mode: "single", fill: color, fillOpacity: 0.55,
    stroke: "#1D4E2C", strokeWidth: 0.5, categories: [],
    labelVisible: false, labelFontSize: 9, labelColor: "#14361F",
  };
}

function defaultRasterSymbology(): Symbology {
  // Raster tidak pakai fill vektor; symbology hanya placeholder untuk legend swatch.
  return {
    mode: "single", fill: "#8A5A34", fillOpacity: 1,
    stroke: "#8A5A34", strokeWidth: 0, categories: [],
    labelVisible: false,
  };
}

function defaultAnalysisZoneSymbology(): Symbology {
  return {
    mode: "categorized",
    fill: "#C0392B",
    fillOpacity: 0.6,
    stroke: "#ffffff",
    strokeWidth: 0.5,
    categoryField: "is_problematic",
    categories: [
      { value: "true",  color: "#C0392B", label: "Bermasalah" },
      { value: "false", color: "#5FA83F", label: "Normal"     },
    ],
    labelVisible: false,
    labelFontSize: 9,
    labelColor: "#14361F",
  };
}

// ── Katalog GEE ───────────────────────────────────────────────────────────────
export const GEE_AVAILABLE: AvailableLayer[] = [
  { id: "gee-ndvi",  name: "NDVI (Sentinel-2)",           group: "gee", sourceRef: "ndvi"           },
  { id: "gee-evi",   name: "EVI (Sentinel-2)",            group: "gee", sourceRef: "evi"            },
  { id: "gee-lst",   name: "Land Surface Temp (MODIS)",   group: "gee", sourceRef: "lst"            },
  { id: "gee-rain",  name: "Rainfall (CHIRPS)",           group: "gee", sourceRef: "rain"           },
  { id: "gee-soil",  name: "Soil Moisture (SMAP)",        group: "gee", sourceRef: "soil_moisture"  },
  { id: "gee-et",    name: "Evapotranspiration (MOD16)",  group: "gee", sourceRef: "et"             },
];

const GEE_COLORS: Record<string, string> = {
  ndvi:          "#5FA83F",
  evi:           "#4D7C0F",
  lst:           "#C0392B",
  rain:          "#1D6FA4",
  soil_moisture: "#0891b2",
  et:            "#6D28D9",
};

// ── Initial State ─────────────────────────────────────────────────────────────
let state: MapState = {
  basemap: DEFAULT_BASEMAP,
  insetsEnabled: false,
  insets: [
    { id: "inset-1", layer: "ndvi" },
    { id: "inset-2", layer: "rain" },
  ],
  // Tidak ada default layer. Startup zoom ke reference layer terbaru
  // ditangani di LeftPanel (auto-add) — blok hanya dirender bila diaktifkan.
  activeLayers: [],
  selectedLayerId: null,
  dbLayers: [],
  leftTab: "layers",
  threeD: false,
  tableLayer: null,
  analysisResult: null,
  analysisRunning: false,
  temporalGroupId: null,
  rasterLayers: [],
  clipRasterToBoundary: false,
  layerErrors: {},
};

const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); }
function set(patch: Partial<MapState>) { state = { ...state, ...patch }; emit(); }

// ── Store Actions ─────────────────────────────────────────────────────────────
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

  // Layers
  selectLayer: (selectedLayerId: string | null) => set({ selectedLayerId }),

  toggleLayerVisible: (id: string) =>
    set({ activeLayers: state.activeLayers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)) }),

  toggleLayerLock: (id: string) =>
    set({ activeLayers: state.activeLayers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l)) }),

  removeLayer: (id: string) => {
    const target = state.activeLayers.find((l) => l.id === id);
    if (target?.locked) return;
    set({
      activeLayers: state.activeLayers.filter((l) => l.id !== id),
      selectedLayerId: state.selectedLayerId === id ? null : state.selectedLayerId,
    });
  },

  addAvailableLayer: (a: AvailableLayer) => {
    if (state.activeLayers.some((l) => l.sourceRef === a.sourceRef && l.kind !== "blocks")) return;
    const id = `layer-${a.id}-${Date.now()}`;
    const isRef = a.layerRole === "reference";
    const kind: LayerKind = isRef ? "reference" : (a.group === "gee" ? "gee" : "db");
    const color = a.group === "gee" ? GEE_COLORS[a.sourceRef ?? ""] ?? "#0ea5e9" : "#5FA83F";
    const classes = a.layerConfig?.classes ?? [];
    const refConfig: ReferenceLayerConfig | undefined = isRef ? {
      diagnosticField: a.diagnosticField ?? "",
      classes,
      weight: a.layerConfig?.weight ?? 1.0,
      periodLabel: a.periodLabel,
      layerGroup: a.layerGroup,
      dbLayerId: a.sourceRef,
    } : undefined;

    set({
      activeLayers: [
        {
          id, name: a.name, kind, visible: true,
          symbology: isRef
            ? defaultReferenceSymbology(classes, a.diagnosticField)
            : defaultGeeSymbology(color),
          sourceRef: a.sourceRef,
          referenceConfig: refConfig,
        },
        ...state.activeLayers,
      ],
      selectedLayerId: id,
    });
  },

  addDbLayer: (a: AvailableLayer, geojson: GeoJSON.FeatureCollection) => {
    if (state.activeLayers.some((l) => l.sourceRef === a.sourceRef && l.kind === "db")) return;
    const id = `layer-${a.id}-${Date.now()}`;
    const isRef = a.layerRole === "reference";
    const kind: LayerKind = isRef ? "reference" : "db";
    const classes = a.layerConfig?.classes ?? [];
    set({
      activeLayers: [
        {
          id, name: a.name, kind, visible: true, sourceRef: a.sourceRef,
          symbology: isRef
            ? defaultReferenceSymbology(classes, a.diagnosticField)
            : defaultGeeSymbology("#5FA83F"),
          data: geojson,
          referenceConfig: isRef ? {
            diagnosticField: a.diagnosticField ?? "",
            classes,
            weight: a.layerConfig?.weight ?? 1.0,
            periodLabel: a.periodLabel,
            layerGroup: a.layerGroup,
            dbLayerId: a.sourceRef,
          } : undefined,
        },
        ...state.activeLayers,
      ],
      selectedLayerId: id,
    });
  },

  // Tambah kembali layer blok (AOI) — tidak ada di startup, opsional via panel.
  addBlocksLayer: () => {
    if (state.activeLayers.some((l) => l.kind === "blocks")) return;
    set({
      activeLayers: [
        {
          id: "layer-blocks",
          name: "Harvest Blocks",
          kind: "blocks",
          visible: true,
          symbology: defaultBlocksSymbology(),
        },
        ...state.activeLayers,
      ],
      selectedLayerId: "layer-blocks",
    });
  },

  // Katalog raster COG dari DB
  setRasterLayers: (rasterLayers: AvailableLayer[]) => set({ rasterLayers }),

  // Tambah raster COG ke peta (overlay)
  addRasterLayer: (a: AvailableLayer) => {
    if (!a.rasterConfig) return;
    if (state.activeLayers.some((l) => l.kind === "raster" && l.sourceRef === a.sourceRef)) return;
    const id = `layer-${a.id}-${Date.now()}`;
    const newLayer: ActiveLayer = {
      id, name: a.name, kind: "raster", visible: true, sourceRef: a.sourceRef,
      symbology: defaultRasterSymbology(),
      rasterConfig: a.rasterConfig,
    };
    set({
      activeLayers: [newLayer, ...state.activeLayers],
      selectedLayerId: id,
    });
    zoomToLayer(newLayer);
  },

  updateRasterOpacity: (id: string, opacity: number) =>
    set({
      activeLayers: state.activeLayers.map((l) =>
        l.id === id && l.rasterConfig
          ? { ...l, rasterConfig: { ...l.rasterConfig, opacity } }
          : l,
      ),
    }),

  /**
   * Ubah konfigurasi raster (colormap / rentang nilai / opacity / bounds).
   * MapView membangun ulang source bila colormap atau rentang berubah, karena
   * nilai itu tertanam di fragment URL protokol `cog://`.
   */
  updateRasterConfig: (id: string, patch: Partial<RasterLayerConfig>) =>
    set({
      activeLayers: state.activeLayers.map((l) =>
        l.id === id && l.rasterConfig && !l.locked
          ? { ...l, rasterConfig: { ...l.rasterConfig, ...patch } }
          : l,
      ),
    }),

  // Kegagalan render per layer (diisi MapView dari event error MapLibre).
  //
  // WAJIB idempoten: fungsi ini dipanggil dari applyRasterMask() yang berjalan
  // pada SETIAP emit store. Bila set() dipanggil tanpa syarat, tiap panggilan
  // memicu emit -> subscriber MapView -> applyRasterMask -> set() lagi = loop
  // tak berujung yang membekukan aplikasi begitu ada raster aktif.
  setLayerError: (id: string, message: string | null) => {
    const current = state.layerErrors[id] ?? null;
    const next = message ?? null;
    if (current === next) return;
    const layerErrors = { ...state.layerErrors };
    if (next) layerErrors[id] = next;
    else delete layerErrors[id];
    set({ layerErrors });
  },

  setClipRasterToBoundary: (clipRasterToBoundary: boolean) => set({ clipRasterToBoundary }),

  // Tambah layer hasil analisis (zona)
  addAnalysisZoneLayer: (result: AnalysisResult) => {
    const id = `layer-analysis-${Date.now()}`;
    set({
      activeLayers: [
        {
          id, name: "Zona Analisis", kind: "db", visible: true,
          symbology: defaultAnalysisZoneSymbology(),
          data: result.zonesGeojson,
        },
        ...state.activeLayers,
      ],
      selectedLayerId: id,
    });
  },

  updateSymbology: (id: string, patch: Partial<Symbology>) =>
    set({
      activeLayers: state.activeLayers.map((l) =>
        l.id === id && !l.locked ? { ...l, symbology: { ...l.symbology, ...patch } } : l,
      ),
    }),

  updateReferenceConfig: (id: string, patch: Partial<ReferenceLayerConfig>) =>
    set({
      activeLayers: state.activeLayers.map((l) => {
        if (l.id !== id || !l.referenceConfig || l.locked) return l;
        const referenceConfig = { ...l.referenceConfig, ...patch };
        return {
          ...l,
          referenceConfig,
          symbology: symbologyFromClasses(
            l.symbology,
            referenceConfig.classes,
            referenceConfig.diagnosticField,
          ),
        };
      }),
    }),

  reorderLayer: (id: string, dir: -1 | 1) => {
    const arr = [...state.activeLayers];
    const i = arr.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length || arr[i].locked || arr[j].locked) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set({ activeLayers: arr });
  },

  // DB layers
  setDbLayers: (dbLayers: AvailableLayer[]) => set({ dbLayers }),

  // Table Layer
  setTableLayer: (tableLayer: TableLayerConfig | null) => set({ tableLayer }),

  // Analysis
  setAnalysisRunning: (analysisRunning: boolean) => set({ analysisRunning }),
  setAnalysisResult: (analysisResult: AnalysisResult | null) => set({ analysisResult }),

  // Temporal
  setTemporalGroupId: (temporalGroupId: string | null) => set({ temporalGroupId }),

  // Tab panel kiri
  setLeftTab: (leftTab: "layers" | "upload") => set({ leftTab }),

  // Mode 3D
  setThreeD: (threeD: boolean) => set({ threeD }),

  MAX_INSETS,

  // Helpers
  getBlockLayer: (): ActiveLayer | undefined => state.activeLayers.find((l) => l.kind === "blocks"),
  getReferenceLayers: (): ActiveLayer[] => state.activeLayers.filter((l) => l.kind === "reference"),
};

// Hook debug (dev only)
if (import.meta.env.DEV) {
  (window as unknown as { __mapStore?: typeof mapStore }).__mapStore = mapStore;
}

export function useMapStore<T>(selector: (s: MapState) => T): T {
  return useSyncExternalStore(
    mapStore.subscribe,
    () => selector(state),
    () => selector(state),
  );
}

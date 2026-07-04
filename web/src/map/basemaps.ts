import type maplibregl from "maplibre-gl";

// ── Registry basemap (maks 5) ────────────────────────────────────────────────
// Semua sumber berlisensi jelas & gratis. Default "imagery" memakai Esri World
// Imagery (bukan tile Google Satellite mentah yang melanggar ToS Google untuk
// aplikasi non-Google-Maps). Ganti basemap berlaku untuk peta utama & semua inset.
export type BasemapId = "imagery" | "streets" | "light" | "dark" | "topo";

export interface BasemapDef {
  id: BasemapId;
  label: string;
  tiles: string[];
  attribution: string;
  maxzoom?: number;
}

export const BASEMAPS: BasemapDef[] = [
  {
    id: "imagery",
    label: "Imagery (Satellite)",
    // Perhatikan urutan {z}/{y}/{x} pada Esri.
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    maxzoom: 19,
  },
  {
    id: "streets",
    label: "Streets (OSM)",
    tiles: [
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
    ],
    attribution: "© OpenStreetMap contributors",
    maxzoom: 19,
  },
  {
    id: "light",
    label: "Light",
    tiles: [
      "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
    ],
    attribution: "© OpenStreetMap, © CARTO",
    maxzoom: 20,
  },
  {
    id: "dark",
    label: "Dark",
    tiles: [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    ],
    attribution: "© OpenStreetMap, © CARTO",
    maxzoom: 20,
  },
  {
    id: "topo",
    label: "Topographic",
    tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png"],
    attribution: "© OpenTopoMap (CC-BY-SA), © OpenStreetMap",
    maxzoom: 17,
  },
];

export const DEFAULT_BASEMAP: BasemapId = "imagery";

const BASEMAP_LAYER_ID = "basemap";
const BASEMAP_SOURCE_ID = "basemap";

export function getBasemap(id: BasemapId): BasemapDef {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

/** Style minimal berisi satu basemap raster (dipakai saat init peta). */
export function baseStyle(id: BasemapId): maplibregl.StyleSpecification {
  const b = getBasemap(id);
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      [BASEMAP_SOURCE_ID]: {
        type: "raster",
        tiles: b.tiles,
        tileSize: 256,
        attribution: b.attribution,
        maxzoom: b.maxzoom ?? 19,
      },
    },
    layers: [{ id: BASEMAP_LAYER_ID, type: "raster", source: BASEMAP_SOURCE_ID }],
  };
}

/**
 * Tukar basemap pada map yang sudah ada tanpa menghapus layer vektor lain.
 * Basemap selalu ditaruh paling bawah (sebelum layer pertama non-basemap).
 */
export function applyBasemap(map: maplibregl.Map, id: BasemapId): void {
  const b = getBasemap(id);
  if (map.getLayer(BASEMAP_LAYER_ID)) map.removeLayer(BASEMAP_LAYER_ID);
  if (map.getSource(BASEMAP_SOURCE_ID)) map.removeSource(BASEMAP_SOURCE_ID);

  map.addSource(BASEMAP_SOURCE_ID, {
    type: "raster",
    tiles: b.tiles,
    tileSize: 256,
    attribution: b.attribution,
    maxzoom: b.maxzoom ?? 19,
  });

  // Sisipkan di bawah layer pertama yang bukan basemap agar tetap paling bawah.
  const firstOther = map.getStyle().layers?.find((l) => l.id !== BASEMAP_LAYER_ID);
  map.addLayer(
    { id: BASEMAP_LAYER_ID, type: "raster", source: BASEMAP_SOURCE_ID },
    firstOther?.id,
  );
}

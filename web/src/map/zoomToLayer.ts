import maplibregl from "maplibre-gl";
import type { ActiveLayer } from "../store/mapStore";

// ── Zoom ke layer (tombol di panel kiri + auto-zoom startup) ─────────────────
// Peta utama didaftarkan oleh MapView (interactive). Bila zoom diminta sebelum
// peta siap (mis. saat startup), permintaan diantre hingga peta load.

let mainMap: maplibregl.Map | null = null;
const pending: Array<() => void> = [];

export function registerMainMap(map: maplibregl.Map | null) {
  mainMap = map;
  if (map) {
    const queued = pending.splice(0, pending.length);
    for (const fn of queued) runWhenReady(fn);
  }
}

function runWhenReady(fn: () => void) {
  if (mainMap && mainMap.loaded()) { fn(); return; }
  if (mainMap && !mainMap.loaded()) { mainMap.once("load", fn); return; }
  pending.push(fn);
}

function extendCoords(b: maplibregl.LngLatBounds, geom: GeoJSON.Geometry) {
  switch (geom.type) {
    case "Point":
      b.extend([geom.coordinates[0], geom.coordinates[1]]);
      break;
    case "MultiPoint":
    case "LineString":
      for (const c of geom.coordinates) b.extend([c[0], c[1]]);
      break;
    case "MultiLineString":
    case "Polygon":
      for (const ring of geom.coordinates) for (const c of ring) b.extend([c[0], c[1]]);
      break;
    case "MultiPolygon":
      for (const poly of geom.coordinates)
        for (const ring of poly) for (const c of ring) b.extend([c[0], c[1]]);
      break;
    default:
      break;
  }
}

// Hitung bbox layer: geojson vektor / bounds raster COG.
export function canZoomToLayer(layer: ActiveLayer): boolean {
  if (layer.rasterConfig?.bounds) return true;
  const data = layer.data;
  return !!data && data.features.length > 0;
}

export function zoomToLayer(layer: ActiveLayer): boolean {
  let bbox: [number, number, number, number] | null = null;

  if (layer.rasterConfig?.bounds) {
    bbox = layer.rasterConfig.bounds;
  } else if (layer.data && layer.data.features.length > 0) {
    const b = new maplibregl.LngLatBounds();
    for (const feat of layer.data.features) extendCoords(b, feat.geometry);
    if (!b.isEmpty()) bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  }

  if (!bbox) return false;

  runWhenReady(() => {
    if (!mainMap) return;
    mainMap.fitBounds(
      [[bbox![0], bbox![1]], [bbox![2], bbox![3]]],
      { padding: 60, duration: 900, maxZoom: 18 },
    );
  });
  return true;
}

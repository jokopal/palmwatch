import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { BlockCollection } from "../types";
import { applyBasemap, baseStyle } from "../map/basemaps";
import { mapStore, type InsetLayerKey, type Symbology } from "../store/mapStore";
import { fillColorExpr } from "../map/symbology";
import { rampColorExpr } from "../map/ramps";

interface Props {
  data: BlockCollection | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMapLoad?: (map: maplibregl.Map) => void;
  interactive?: boolean;
  /** Bila diisi (inset), poligon blok diwarnai choropleth per variabel EO. */
  colorBy?: InsetLayerKey;
}

function blocksSymbology(): Symbology | undefined {
  return mapStore.getState().activeLayers.find((l) => l.kind === "blocks")?.symbology;
}
function blocksVisible(): boolean {
  return mapStore.getState().activeLayers.find((l) => l.kind === "blocks")?.visible ?? true;
}

function fillColor(colorBy?: InsetLayerKey): maplibregl.ExpressionSpecification | string {
  if (colorBy) return rampColorExpr(colorBy);
  const sym = blocksSymbology();
  return sym ? fillColorExpr(sym) : "#3b82f6";
}
function fillOpacity(colorBy?: InsetLayerKey): number {
  if (colorBy) return 0.75;
  return blocksSymbology()?.fillOpacity ?? 0.65;
}
function lineColor(id: string | null, colorBy?: InsetLayerKey): maplibregl.ExpressionSpecification {
  const stroke = colorBy ? "#ffffff" : blocksSymbology()?.stroke ?? "#ffffff";
  return ["case", ["==", ["get", "block_id"], id ?? ""], "#2563eb", stroke];
}
function lineWidth(id: string | null, colorBy?: InsetLayerKey): maplibregl.ExpressionSpecification {
  const w = colorBy ? 0.5 : blocksSymbology()?.strokeWidth ?? 1;
  return ["case", ["==", ["get", "block_id"], id ?? ""], 3, w];
}

export default function MapView({
  data,
  selectedId = null,
  onSelect,
  onMapLoad,
  interactive = true,
  colorBy,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);

  const dataRef = useRef<BlockCollection | null>(data);
  const selRef = useRef<string | null>(selectedId);
  const onSelectRef = useRef(onSelect);
  const colorByRef = useRef(colorBy);
  dataRef.current = data;
  selRef.current = selectedId;
  onSelectRef.current = onSelect;
  colorByRef.current = colorBy;

  // Rekonsiliasi layer DB (GeoJSON hasil upload) ke sumber/layer MapLibre.
  function syncDbLayers() {
    const map = mapRef.current;
    if (!map || !loadedRef.current || colorByRef.current) return; // inset dilewati
    const dbLayers = mapStore.getState().activeLayers.filter((l) => l.kind === "db" && l.data);
    const wanted = new Set(dbLayers.map((l) => `db-${l.id}`));

    for (const srcId of Object.keys(map.getStyle().sources ?? {})) {
      if (srcId.startsWith("db-") && !wanted.has(srcId)) {
        for (const t of ["fill", "line"]) if (map.getLayer(`${srcId}-${t}`)) map.removeLayer(`${srcId}-${t}`);
        if (map.getSource(srcId)) map.removeSource(srcId);
      }
    }
    for (const l of dbLayers) {
      const srcId = `db-${l.id}`;
      const s = l.symbology;
      if (!map.getSource(srcId)) {
        map.addSource(srcId, { type: "geojson", data: l.data as never });
        map.addLayer({ id: `${srcId}-fill`, type: "fill", source: srcId, paint: { "fill-color": s.fill, "fill-opacity": s.fillOpacity } });
        map.addLayer({ id: `${srcId}-line`, type: "line", source: srcId, paint: { "line-color": s.stroke, "line-width": s.strokeWidth } });
      } else {
        map.setPaintProperty(`${srcId}-fill`, "fill-color", fillColorExpr(s) as never);
        map.setPaintProperty(`${srcId}-fill`, "fill-opacity", s.fillOpacity);
        map.setPaintProperty(`${srcId}-line`, "line-color", s.stroke);
        map.setPaintProperty(`${srcId}-line`, "line-width", s.strokeWidth);
      }
      const vis = l.visible ? "visible" : "none";
      for (const t of ["fill", "line"]) if (map.getLayer(`${srcId}-${t}`)) map.setLayoutProperty(`${srcId}-${t}`, "visibility", vis);
    }
  }

  // Mode 3D: terrain (DEM) + ekstrusi blok (tinggi = severity) + pitch.
  // Hanya untuk peta utama (bukan inset).
  function apply3D() {
    const map = mapRef.current;
    if (!map || !loadedRef.current || colorByRef.current) return;
    const on = mapStore.getState().threeD;
    if (on) {
      if (!map.getSource("dem")) {
        map.addSource("dem", {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          encoding: "terrarium", tileSize: 256, maxzoom: 14,
        });
      }
      map.setTerrain({ source: "dem", exaggeration: 1.4 });
      try {
        map.setSky({ "sky-color": "#8ec5fc", "horizon-color": "#eaf3ff", "fog-color": "#ffffff", "fog-ground-blend": 0.6 } as never);
      } catch { /* sky opsional */ }
      if (map.getSource("blocks") && !map.getLayer("blocks-3d")) {
        map.addLayer({
          id: "blocks-3d", type: "fill-extrusion", source: "blocks",
          paint: {
            "fill-extrusion-color": fillColor(undefined) as never,
            "fill-extrusion-height": ["+", 150, ["*", ["coalesce", ["get", "severity_score"], 0.5], 180]] as never,
            "fill-extrusion-base": 0,
            "fill-extrusion-opacity": 0.9,
          },
        });
      }
      if (map.getLayer("blocks-fill")) map.setLayoutProperty("blocks-fill", "visibility", "none");
      if (map.getPitch() < 25) map.easeTo({ pitch: 60, duration: 700 });
    } else {
      try { map.setTerrain(null as never); } catch { /* ignore */ }
      if (map.getLayer("blocks-3d")) map.removeLayer("blocks-3d");
      if (map.getLayer("blocks-fill")) map.setLayoutProperty("blocks-fill", "visibility", blocksVisible() ? "visible" : "none");
      if (map.getPitch() > 5) map.easeTo({ pitch: 0, duration: 700 });
    }
  }

  function render() {
    const map = mapRef.current;
    const fc = dataRef.current;
    if (!map || !loadedRef.current || !fc) return;
    const cb = colorByRef.current;

    const src = map.getSource("blocks") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(fc as never);
      return;
    }

    map.addSource("blocks", { type: "geojson", data: fc as never });
    map.addLayer({
      id: "blocks-fill",
      type: "fill",
      source: "blocks",
      paint: { "fill-color": fillColor(cb), "fill-opacity": fillOpacity(cb) },
    });
    map.addLayer({
      id: "blocks-line",
      type: "line",
      source: "blocks",
      paint: { "line-color": lineColor(selRef.current, cb), "line-width": lineWidth(selRef.current, cb) },
    });

    if (interactive) {
      map.addLayer({
        id: "blocks-label",
        type: "symbol",
        source: "blocks",
        layout: { "text-field": ["get", "block_id"], "text-size": 11 },
        paint: { "text-color": "#1f2937", "text-halo-color": "#ffffff", "text-halo-width": 1.2 },
      });

      map.on("click", "blocks-fill", (e) => {
        const f = e.features?.[0];
        if (f && onSelectRef.current) onSelectRef.current(f.properties!.block_id as string);
      });
      map.on("mouseenter", "blocks-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "blocks-fill", () => (map.getCanvas().style.cursor = ""));
    }

    const b = new maplibregl.LngLatBounds();
    for (const feat of fc.features) {
      for (const ring of feat.geometry.coordinates) {
        for (const [lng, lat] of ring) b.extend([lng, lat]);
      }
    }
    if (!b.isEmpty() && interactive) map.fitBounds(b, { padding: 60, duration: 0 });
    apply3D(); // pasang ekstrusi bila 3D sudah aktif saat data masuk
  }

  // Init map sekali
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: baseStyle(mapStore.getState().basemap),
      center: [117.15, -0.535],
      zoom: 11,
      interactive: interactive,
      attributionControl: false, // map display bersih (atribusi disembunyikan atas permintaan)
    });
    if (interactive) map.addControl(new maplibregl.NavigationControl({}), "top-left");
    map.on("load", () => {
      loadedRef.current = true;
      if (onMapLoad) onMapLoad(map);
      if (import.meta.env.DEV && interactive) (window as unknown as { __map?: maplibregl.Map }).__map = map;
      render();
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, [interactive]);

  // Resize peta saat kontainer berubah ukuran (fix pane putih saat startup/
  // tambah inset/resize panel — MapLibre tidak auto-resize).
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    render();
  }, [data]);

  // Sinkron basemap + simbologi/visibilitas layer blok dari store.
  useEffect(() => {
    let curBasemap = mapStore.getState().basemap;
    const applySymbology = () => {
      const map = mapRef.current;
      if (!map || !loadedRef.current || !map.getLayer("blocks-fill")) return;
      const cb = colorByRef.current;
      map.setPaintProperty("blocks-fill", "fill-color", fillColor(cb) as never);
      map.setPaintProperty("blocks-fill", "fill-opacity", fillOpacity(cb));
      map.setPaintProperty("blocks-line", "line-color", lineColor(selRef.current, cb) as never);
      map.setPaintProperty("blocks-line", "line-width", lineWidth(selRef.current, cb) as never);
      const vis = blocksVisible() ? "visible" : "none";
      for (const lid of ["blocks-fill", "blocks-line", "blocks-label"]) {
        if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", vis);
      }
      if (map.getLayer("blocks-3d")) map.setPaintProperty("blocks-3d", "fill-extrusion-color", fillColor(undefined) as never);
    };
    let cur3D = mapStore.getState().threeD;
    const unsub = mapStore.subscribe(() => {
      const map = mapRef.current;
      const next = mapStore.getState().basemap;
      if (next !== curBasemap) {
        curBasemap = next;
        if (map && loadedRef.current) applyBasemap(map, next);
      }
      applySymbology();
      syncDbLayers();
      const n3d = mapStore.getState().threeD;
      if (n3d !== cur3D) { cur3D = n3d; apply3D(); }
    });
    return unsub;
  }, []);

  // Highlight seleksi.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !map.getLayer("blocks-line")) return;
    map.setPaintProperty("blocks-line", "line-color", lineColor(selectedId || null, colorByRef.current) as never);
    map.setPaintProperty("blocks-line", "line-width", lineWidth(selectedId || null, colorByRef.current) as never);
  }, [selectedId]);

  return <div style={{ position: "absolute", inset: 0 }} ref={ref} />;
}

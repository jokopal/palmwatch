import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { cogProtocol } from "@geomatico/maplibre-cog-protocol";
import type { BlockCollection } from "../types";
import { applyBasemap, baseStyle } from "../map/basemaps";
import { mapStore, type ActiveLayer, type InsetLayerKey, type RasterLayerConfig, type Symbology } from "../store/mapStore";
import { fillColorExpr } from "../map/symbology";
import { rampColorExpr } from "../map/ramps";

// Registrasi protokol COG sekali untuk seluruh aplikasi (idempoten).
let cogProtocolRegistered = false;
function ensureCogProtocol() {
  if (cogProtocolRegistered) return;
  maplibregl.addProtocol("cog", cogProtocol);
  cogProtocolRegistered = true;
}

// Bangun URL sumber untuk maplibre-cog-protocol.
// Single-band + colormap → fragment "#color:<scheme>,<min>,<max>,c"; selain itu RGB apa adanya.
function cogSourceUrl(cfg: RasterLayerConfig): string {
  const base = `cog://${cfg.url}`;
  if (cfg.colormap && cfg.minValue != null && cfg.maxValue != null) {
    return `${base}#color:${cfg.colormap},${cfg.minValue},${cfg.maxValue},c`;
  }
  return base;
}

// MapView — render engine utama PalmWatch
// Sumber data:
//   - "blocks" source: BlockCollection dari API (priority_level, block_id, dll)
//   - "overlay-<id>" source: setiap ActiveLayer selain blocks (reference, db, analysis zone)
//
// Symb engine:
//   fillColorExpr() untuk single & kategorized (match expression)
//   Label dari l.symbology.labelField (opsional, toggle via labelVisible)

interface Props {
  data: BlockCollection | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMapLoad?: (map: maplibregl.Map) => void;
  interactive?: boolean;
  /** Bila diisi (inset), poligon blok diwarnai choropleth per variabel EO. */
  colorBy?: InsetLayerKey;
}

// ── Helper: ambil nilai dari store ───────────────────────────────────────────
function blocksLayer(): ActiveLayer | undefined {
  return mapStore.getState().activeLayers.find((l) => l.kind === "blocks");
}
function blocksSymbology(): Symbology | undefined {
  return blocksLayer()?.symbology;
}
function blocksVisible(): boolean {
  return blocksLayer()?.visible ?? true;
}

function fillColor(colorBy?: InsetLayerKey): maplibregl.ExpressionSpecification | string {
  if (colorBy) return rampColorExpr(colorBy);
  const sym = blocksSymbology();
  return sym ? fillColorExpr(sym) : "#5FA83F";
}
function fillOpacity(colorBy?: InsetLayerKey): number {
  if (colorBy) return 0.75;
  return blocksSymbology()?.fillOpacity ?? 0.65;
}
function lineColor(id: string | null, colorBy?: InsetLayerKey): maplibregl.ExpressionSpecification {
  const stroke = colorBy ? "#ffffff" : blocksSymbology()?.stroke ?? "#ffffff";
  return ["case", ["==", ["get", "block_id"], id ?? ""], "#9BCB4F", stroke];
}
function lineWidth(id: string | null, colorBy?: InsetLayerKey): maplibregl.ExpressionSpecification {
  const w = colorBy ? 0.5 : blocksSymbology()?.strokeWidth ?? 1;
  return ["case", ["==", ["get", "block_id"], id ?? ""], 3, w];
}

// ── Helper: prefix source/layer ID untuk overlay ─────────────────────────────
const ovSrc  = (id: string) => `ov-src-${id}`;
const ovFill = (id: string) => `ov-fill-${id}`;
const ovLine = (id: string) => `ov-line-${id}`;
const ovLbl  = (id: string) => `ov-lbl-${id}`;
const rastSrc = (id: string) => `rast-src-${id}`;
const rastLyr = (id: string) => `rast-${id}`;

// ── Ekspresi label untuk symbol layer ────────────────────────────────────────
function labelLayoutExpr(sym: Symbology) {
  const field = sym.labelField?.trim();
  if (!field) return { "text-field": "", "text-size": 10 };
  return {
    "text-field": ["get", field] as maplibregl.ExpressionSpecification,
    "text-size": sym.labelFontSize ?? 10,
    "text-allow-overlap": false,
    "text-ignore-placement": false,
    "text-max-width": 8,
  };
}

export default function MapView({
  data,
  selectedId = null,
  onSelect,
  onMapLoad,
  interactive = true,
  colorBy,
}: Props) {
  const ref     = useRef<HTMLDivElement>(null);
  const mapRef  = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);

  const dataRef      = useRef<BlockCollection | null>(data);
  const selRef       = useRef<string | null>(selectedId);
  const onSelectRef  = useRef(onSelect);
  const colorByRef   = useRef(colorBy);
  dataRef.current     = data;
  selRef.current      = selectedId;
  onSelectRef.current = onSelect;
  colorByRef.current  = colorBy;

  // ── syncOverlayLayers ──────────────────────────────────────────────────────
  // Rekonsiliasi semua non-block layer (reference/db/analysis zone) ke MapLibre.
  // Dipanggil tiap kali store berubah.
  function syncOverlayLayers() {
    const map = mapRef.current;
    if (!map || !loadedRef.current || colorByRef.current) return;

    const overlayLayers = mapStore.getState().activeLayers.filter(
      (l) => l.kind !== "blocks" && l.kind !== "gee" && l.data,
    );
    const wantedIds = new Set(overlayLayers.map((l) => l.id));

    // Hapus layer yang tidak lagi ada di store
    for (const srcId of Object.keys((map.getStyle() as { sources?: Record<string, unknown> }).sources ?? {})) {
      if (!srcId.startsWith("ov-src-")) continue;
      const lid = srcId.slice("ov-src-".length);
      if (!wantedIds.has(lid)) {
        for (const fn of [ovLbl, ovLine, ovFill]) {
          if (map.getLayer(fn(lid))) map.removeLayer(fn(lid));
        }
        if (map.getSource(srcId)) map.removeSource(srcId);
      }
    }

    // Tambah / update overlay layers
    for (const l of overlayLayers) {
      const srcId = ovSrc(l.id);
      const s = l.symbology;
      const vis = l.visible ? "visible" : "none";
      const fillExpr = fillColorExpr(s);

      if (!map.getSource(srcId)) {
        // Tambah source baru
        map.addSource(srcId, { type: "geojson", data: l.data as GeoJSON.FeatureCollection });

        // Fill layer
        map.addLayer({
          id: ovFill(l.id),
          type: "fill",
          source: srcId,
          paint: {
            "fill-color": fillExpr as maplibregl.ColorSpecification,
            "fill-opacity": s.fillOpacity,
          },
          layout: { visibility: vis },
        });

        // Stroke layer
        map.addLayer({
          id: ovLine(l.id),
          type: "line",
          source: srcId,
          paint: {
            "line-color": s.stroke,
            "line-width": s.strokeWidth,
          },
          layout: { visibility: vis },
        });

        // Label layer (opsional)
        if (s.labelVisible && s.labelField) {
          map.addLayer({
            id: ovLbl(l.id),
            type: "symbol",
            source: srcId,
            layout: {
              ...labelLayoutExpr(s),
              visibility: vis,
            } as never,
            paint: {
              "text-color": s.labelColor ?? "#ffffff",
              "text-halo-color": "rgba(0,0,0,0.5)",
              "text-halo-width": 1,
            },
          });
        }

      } else {
        // Update source data jika berubah
        (map.getSource(srcId) as maplibregl.GeoJSONSource).setData(l.data as GeoJSON.FeatureCollection);

        // Update paint properties
        if (map.getLayer(ovFill(l.id))) {
          map.setPaintProperty(ovFill(l.id), "fill-color", fillExpr as never);
          map.setPaintProperty(ovFill(l.id), "fill-opacity", s.fillOpacity);
          map.setLayoutProperty(ovFill(l.id), "visibility", vis);
        }
        if (map.getLayer(ovLine(l.id))) {
          map.setPaintProperty(ovLine(l.id), "line-color", s.stroke);
          map.setPaintProperty(ovLine(l.id), "line-width", s.strokeWidth);
          map.setLayoutProperty(ovLine(l.id), "visibility", vis);
        }

        // Label: tambah jika baru aktif, hapus jika dimatikan
        if (s.labelVisible && s.labelField) {
          if (!map.getLayer(ovLbl(l.id))) {
            map.addLayer({
              id: ovLbl(l.id),
              type: "symbol",
              source: srcId,
              layout: { ...labelLayoutExpr(s), visibility: vis } as never,
              paint: {
                "text-color": s.labelColor ?? "#ffffff",
                "text-halo-color": "rgba(0,0,0,0.5)",
                "text-halo-width": 1,
              },
            });
          } else {
            map.setLayoutProperty(ovLbl(l.id), "text-field", ["get", s.labelField] as never);
            map.setLayoutProperty(ovLbl(l.id), "text-size", s.labelFontSize ?? 10);
            map.setLayoutProperty(ovLbl(l.id), "visibility", vis);
            map.setPaintProperty(ovLbl(l.id), "text-color", s.labelColor ?? "#ffffff");
          }
        } else if (map.getLayer(ovLbl(l.id))) {
          map.setLayoutProperty(ovLbl(l.id), "visibility", "none");
        }
      }
    }
  }

  // ── syncRasterLayers ────────────────────────────────────────────────────────
  // Rekonsiliasi semua raster COG (kind === "raster") ke MapLibre. Ditaruh DI BAWAH
  // blok/overlay vektor (beforeId) agar poligon tetap terlihat di atas raster.
  function syncRasterLayers() {
    const map = mapRef.current;
    if (!map || !loadedRef.current || colorByRef.current) return;

    const rasterLayers = mapStore.getState().activeLayers.filter(
      (l) => l.kind === "raster" && l.rasterConfig,
    );
    const wantedIds = new Set(rasterLayers.map((l) => l.id));

    // Hapus raster yang tidak lagi ada di store
    for (const srcId of Object.keys((map.getStyle() as { sources?: Record<string, unknown> }).sources ?? {})) {
      if (!srcId.startsWith("rast-src-")) continue;
      const lid = srcId.slice("rast-src-".length);
      if (!wantedIds.has(lid)) {
        if (map.getLayer(rastLyr(lid))) map.removeLayer(rastLyr(lid));
        if (map.getSource(srcId)) map.removeSource(srcId);
      }
    }

    // Raster harus di bawah blok vektor: sisipkan sebelum layer blok terbawah.
    const beforeId = map.getLayer("blocks-fill") ? "blocks-fill" : undefined;

    for (const l of rasterLayers) {
      const cfg = l.rasterConfig!;
      const srcId = rastSrc(l.id);
      const vis = l.visible ? "visible" : "none";
      if (!map.getSource(srcId)) {
        map.addSource(srcId, { type: "raster", url: cogSourceUrl(cfg), tileSize: 256 });
        map.addLayer({
          id: rastLyr(l.id),
          type: "raster",
          source: srcId,
          paint: { "raster-opacity": cfg.opacity },
          layout: { visibility: vis },
        }, beforeId);
      } else {
        if (map.getLayer(rastLyr(l.id))) {
          map.setPaintProperty(rastLyr(l.id), "raster-opacity", cfg.opacity);
          map.setLayoutProperty(rastLyr(l.id), "visibility", vis);
        }
      }
    }
  }

  // ── Mode 3D ─────────────────────────────────────────────────────────────────
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

  // ── Render block layer ───────────────────────────────────────────────────────
  function renderBlocks() {
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
      paint: { "fill-color": fillColor(cb) as never, "fill-opacity": fillOpacity(cb) },
    });
    map.addLayer({
      id: "blocks-line",
      type: "line",
      source: "blocks",
      paint: { "line-color": lineColor(selRef.current, cb) as never, "line-width": lineWidth(selRef.current, cb) as never },
    });

    if (interactive) {
      const blkSym = blocksSymbology();
      const labelField = blkSym?.labelField ?? "block_id";
      const labelVisible = blkSym?.labelVisible !== false; // default true untuk blocks

      map.addLayer({
        id: "blocks-label",
        type: "symbol",
        source: "blocks",
        layout: {
          "text-field": ["get", labelField],
          "text-size": blkSym?.labelFontSize ?? 11,
          "text-allow-overlap": false,
          "text-ignore-placement": false,
          visibility: labelVisible ? "visible" : "none",
        } as never,
        paint: {
          "text-color": blkSym?.labelColor ?? "#ffffff",
          "text-halo-color": "rgba(0,0,0,0.4)",
          "text-halo-width": 1.2,
        },
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
    apply3D();
    syncRasterLayers(); // raster di bawah blok
    syncOverlayLayers(); // pasang overlay yang sudah dimuat sebelum data masuk
  }

  // ── Init map (sekali) ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    ensureCogProtocol();
    const map = new maplibregl.Map({
      container: ref.current,
      style: baseStyle(mapStore.getState().basemap),
      center: [117.15, -0.535],
      zoom: 11,
      interactive,
      attributionControl: false,
    });
    if (interactive) map.addControl(new maplibregl.NavigationControl({}), "top-left");
    map.on("load", () => {
      loadedRef.current = true;
      if (onMapLoad) onMapLoad(map);
      if (import.meta.env.DEV && interactive) (window as unknown as { __map?: maplibregl.Map }).__map = map;
      renderBlocks();
      syncRasterLayers();
      syncOverlayLayers();
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, [interactive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ResizeObserver ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Data blok berubah ────────────────────────────────────────────────────────
  useEffect(() => { renderBlocks(); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Store subscription (basemap + simbologi blok + overlay layers + 3D) ─────
  useEffect(() => {
    let curBasemap = mapStore.getState().basemap;
    let cur3D = mapStore.getState().threeD;

    const applyBlocksSymbology = () => {
      const map = mapRef.current;
      if (!map || !loadedRef.current || !map.getLayer("blocks-fill")) return;
      const cb = colorByRef.current;
      const blkSym = blocksSymbology();
      map.setPaintProperty("blocks-fill", "fill-color", fillColor(cb) as never);
      map.setPaintProperty("blocks-fill", "fill-opacity", fillOpacity(cb));
      map.setPaintProperty("blocks-line", "line-color", lineColor(selRef.current, cb) as never);
      map.setPaintProperty("blocks-line", "line-width", lineWidth(selRef.current, cb) as never);

      // Visibility blocks
      const vis = blocksVisible() ? "visible" : "none";
      for (const lid of ["blocks-fill", "blocks-line"]) {
        if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", vis);
      }
      // Label blocks
      if (map.getLayer("blocks-label")) {
        const lVis = (blkSym?.labelVisible !== false && blocksVisible()) ? "visible" : "none";
        map.setLayoutProperty("blocks-label", "visibility", lVis);
        if (blkSym?.labelField) {
          map.setLayoutProperty("blocks-label", "text-field", ["get", blkSym.labelField] as never);
          map.setLayoutProperty("blocks-label", "text-size", blkSym.labelFontSize ?? 11);
          map.setPaintProperty("blocks-label", "text-color", blkSym.labelColor ?? "#ffffff");
        }
      }
      // 3D extrusion color
      if (map.getLayer("blocks-3d")) {
        map.setPaintProperty("blocks-3d", "fill-extrusion-color", fillColor(undefined) as never);
      }
    };

    const unsub = mapStore.subscribe(() => {
      const map = mapRef.current;
      // Basemap
      const next = mapStore.getState().basemap;
      if (next !== curBasemap) {
        curBasemap = next;
        if (map && loadedRef.current) applyBasemap(map, next);
      }
      // Blocks symbology
      applyBlocksSymbology();
      // Raster COG layers
      syncRasterLayers();
      // Overlay layers (reference/db/analysis)
      syncOverlayLayers();
      // 3D toggle
      const n3d = mapStore.getState().threeD;
      if (n3d !== cur3D) { cur3D = n3d; apply3D(); }
    });
    return unsub;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Selection highlight ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !map.getLayer("blocks-line")) return;
    map.setPaintProperty("blocks-line", "line-color", lineColor(selectedId || null, colorByRef.current) as never);
    map.setPaintProperty("blocks-line", "line-width", lineWidth(selectedId || null, colorByRef.current) as never);
  }, [selectedId]);

  return <div style={{ position: "absolute", inset: 0 }} ref={ref} />;
}

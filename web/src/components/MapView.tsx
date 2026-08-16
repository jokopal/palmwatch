import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { BlockCollection } from "../types";
import { applyBasemap, baseStyle } from "../map/basemaps";
import { registerMainMap, canZoomToLayer, zoomToLayer } from "../map/zoomToLayer";
import {
  enforceLayerOrder, desiredOrderBottomUp, geometryClassOf,
  ovSrc, ovFill, ovLine, ovCircle, ovLbl, rastSrc, rastLyr,
} from "../map/layerIds";
import { mapStore, type ActiveLayer, type InsetLayerKey, type RasterLayerConfig, type Symbology } from "../store/mapStore";
import { fillColorExpr } from "../map/symbology";
import { rampColorExpr } from "../map/ramps";

function isValidWgs84Bounds(b?: [number, number, number, number]): boolean {
  if (!b || b.length !== 4) return false;
  const [minx, miny, maxx, maxy] = b;
  return (
    minx >= -180 && minx <= 180 &&
    maxx >= -180 && maxx <= 180 &&
    miny >= -90 && miny <= 90 &&
    maxy >= -90 && maxy <= 90 &&
    minx < maxx && miny < maxy
  );
}

// Tanda tangan overlay raster: berubah -> source dibangun ulang. Gambar dan
// penempatannya yang menentukan, bukan warna (warna sudah dipanggang di PNG).
const rasterSignature = (cfg: RasterLayerConfig) =>
  `${cfg.url}|${(cfg.bounds ?? []).join(",")}`;

// MapView — render engine utama PalmWatch
// Sumber data:
//   - "blocks" source: BlockCollection dari API (priority_level, block_id, dll)
//   - "ov-src-<id>"  : setiap ActiveLayer vektor (reference, db, analysis zone)
//   - "rast-src-<id>": setiap ActiveLayer raster COG
//
// Prinsip rekonsiliasi: MapLibre adalah cerminan store, bukan tempat menyimpan
// state. Tiap emit store, kita hitung selisih terhadap apa yang sudah terpasang
// (dilacak lewat ref, bukan getStyle() yang mahal), terapkan yang berubah SAJA,
// lalu tegakkan urutan tumpukan.

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

  // Apa yang SUDAH terpasang di MapLibre — dilacak di sini agar rekonsiliasi
  // tidak perlu memanggil map.getStyle() (menserialisasi seluruh style) tiap emit.
  const overlayIdsRef = useRef<Set<string>>(new Set());
  const rasterSigRef  = useRef<Map<string, string>>(new Map());
  const dataSigRef    = useRef<Map<string, GeoJSON.FeatureCollection>>(new Map());
  const orderSigRef   = useRef<string>("");
  const clickBoundRef = useRef(false);

  // ── syncOverlayLayers ──────────────────────────────────────────────────────
  function syncOverlayLayers() {
    const map = mapRef.current;
    if (!map || !loadedRef.current || colorByRef.current) return;

    const overlayLayers = mapStore.getState().activeLayers.filter(
      (l) => l.kind !== "blocks" && l.kind !== "raster" && l.kind !== "gee" && l.data,
    );
    const wantedIds = new Set(overlayLayers.map((l) => l.id));

    // Hapus layer yang tidak lagi ada di store
    for (const lid of [...overlayIdsRef.current]) {
      if (wantedIds.has(lid)) continue;
      for (const fn of [ovLbl, ovCircle, ovLine, ovFill]) {
        if (map.getLayer(fn(lid))) map.removeLayer(fn(lid));
      }
      if (map.getSource(ovSrc(lid))) map.removeSource(ovSrc(lid));
      overlayIdsRef.current.delete(lid);
      dataSigRef.current.delete(lid);
      mapStore.setLayerError(lid, null);
    }

    for (const l of overlayLayers) {
      const srcId = ovSrc(l.id);
      const s = l.symbology;
      const vis = l.visible ? "visible" : "none";
      const fillExpr = fillColorExpr(s);
      // Jenis layer HARUS cocok dengan geometri: fill tidak menggambar Point,
      // dan line tidak menggambar Polygon secara terisi.
      const geom = geometryClassOf(l.data);

      if (!map.getSource(srcId)) {
        map.addSource(srcId, { type: "geojson", data: l.data as GeoJSON.FeatureCollection });
        overlayIdsRef.current.add(l.id);
        dataSigRef.current.set(l.id, l.data as GeoJSON.FeatureCollection);

        if (geom === "point") {
          map.addLayer({
            id: ovCircle(l.id),
            type: "circle",
            source: srcId,
            paint: {
              "circle-color": fillExpr as maplibregl.ColorSpecification,
              "circle-opacity": s.fillOpacity,
              // Radius mengikuti zoom supaya belasan ribu titik tetap terbaca
              // saat di-zoom-out dan tidak menyatu jadi bidang penuh.
              "circle-radius": [
                "interpolate", ["linear"], ["zoom"],
                10, 1.2, 14, 2.5, 17, 5, 20, 9,
              ] as never,
              "circle-stroke-color": s.stroke,
              "circle-stroke-width": Math.min(s.strokeWidth, 1),
            },
            layout: { visibility: vis },
          });
        } else if (geom === "line") {
          map.addLayer({
            id: ovLine(l.id),
            type: "line",
            source: srcId,
            paint: {
              // Untuk layer garis, warna kategori diterapkan ke garisnya sendiri
              // (bukan ke `stroke` yang di poligon berperan sebagai batas).
              "line-color": fillExpr as maplibregl.ColorSpecification,
              "line-opacity": s.fillOpacity,
              "line-width": Math.max(s.strokeWidth, 1),
            },
            layout: { visibility: vis },
          });
        } else {
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

          map.addLayer({
            id: ovLine(l.id),
            type: "line",
            source: srcId,
            paint: { "line-color": s.stroke, "line-width": s.strokeWidth },
            layout: { visibility: vis },
          });
        }

        if (s.labelVisible && s.labelField) {
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
        }

      } else {
        // setData() hanya bila GeoJSON-nya memang berganti. Dulu ini dipanggil
        // pada SETIAP emit store, sehingga menggeser slider opacity ikut
        // mem-parse ulang seluruh FeatureCollection (berat + berkedip).
        if (dataSigRef.current.get(l.id) !== l.data) {
          (map.getSource(srcId) as maplibregl.GeoJSONSource).setData(l.data as GeoJSON.FeatureCollection);
          dataSigRef.current.set(l.id, l.data as GeoJSON.FeatureCollection);
        }

        if (map.getLayer(ovCircle(l.id))) {
          map.setPaintProperty(ovCircle(l.id), "circle-color", fillExpr as never);
          map.setPaintProperty(ovCircle(l.id), "circle-opacity", s.fillOpacity);
          map.setPaintProperty(ovCircle(l.id), "circle-stroke-color", s.stroke);
          map.setPaintProperty(ovCircle(l.id), "circle-stroke-width", Math.min(s.strokeWidth, 1));
          map.setLayoutProperty(ovCircle(l.id), "visibility", vis);
        }
        if (map.getLayer(ovFill(l.id))) {
          map.setPaintProperty(ovFill(l.id), "fill-color", fillExpr as never);
          map.setPaintProperty(ovFill(l.id), "fill-opacity", s.fillOpacity);
          map.setLayoutProperty(ovFill(l.id), "visibility", vis);
        }
        if (map.getLayer(ovLine(l.id))) {
          // Layer garis murni memakai warna kategori; batas poligon memakai stroke.
          const lineColorValue = geom === "line" ? (fillExpr as never) : (s.stroke as never);
          map.setPaintProperty(ovLine(l.id), "line-color", lineColorValue);
          map.setPaintProperty(ovLine(l.id), "line-width",
            geom === "line" ? Math.max(s.strokeWidth, 1) : s.strokeWidth);
          if (geom === "line") map.setPaintProperty(ovLine(l.id), "line-opacity", s.fillOpacity);
          map.setLayoutProperty(ovLine(l.id), "visibility", vis);
        }

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
  //
  // Raster digambar sebagai overlay PNG lewat `image` source MapLibre: satu URL
  // gambar plus empat koordinat sudut. Tidak ada decoder GeoTIFF, tidak ada
  // range request, tidak ada nama colormap yang harus dikenali library — jalur
  // yang dulu membuat raster gagal tampil tanpa satu pun pesan error.
  //
  // Pewarnaan sudah dipanggang oleh scripts/build_raster_overlays.py, jadi yang
  // masih bisa diubah saat runtime hanyalah opacity dan visibilitas.
  function syncRasterLayers() {
    const map = mapRef.current;
    if (!map || !loadedRef.current || colorByRef.current) return;

    const rasterLayers = mapStore.getState().activeLayers.filter(
      (l) => l.kind === "raster" && l.rasterConfig,
    );
    const wanted = new Map(rasterLayers.map((l) => [l.id, l] as const));

    // Buang raster yang hilang dari store, atau yang gambar/bbox-nya berganti.
    for (const [lid, sig] of [...rasterSigRef.current]) {
      const still = wanted.get(lid);
      const nextSig = still?.rasterConfig ? rasterSignature(still.rasterConfig) : null;
      if (nextSig === sig) continue;
      if (map.getLayer(rastLyr(lid))) map.removeLayer(rastLyr(lid));
      if (map.getSource(rastSrc(lid))) map.removeSource(rastSrc(lid));
      rasterSigRef.current.delete(lid);
      mapStore.setLayerError(lid, null);
    }

    for (const l of rasterLayers) {
      const cfg = l.rasterConfig!;
      const srcId = rastSrc(l.id);
      const vis = l.visible ? "visible" : "none";

      if (!map.getSource(srcId)) {
        if (!isValidWgs84Bounds(cfg.bounds)) {
          mapStore.setLayerError(l.id, "Bbox raster tidak valid — overlay tidak bisa ditempatkan.");
          continue;
        }
        const [w, s2, e, n] = cfg.bounds;
        map.addSource(srcId, {
          type: "image",
          url: cfg.url,
          // Urutan sudut wajib: kiri-atas, kanan-atas, kanan-bawah, kiri-bawah.
          coordinates: [[w, n], [e, n], [e, s2], [w, s2]],
        });
        map.addLayer({
          id: rastLyr(l.id),
          type: "raster",
          source: srcId,
          paint: { "raster-opacity": cfg.opacity, "raster-fade-duration": 0 },
          layout: { visibility: vis },
        });
        rasterSigRef.current.set(l.id, rasterSignature(cfg));
      } else if (map.getLayer(rastLyr(l.id))) {
        map.setPaintProperty(rastLyr(l.id), "raster-opacity", cfg.opacity);
        map.setLayoutProperty(rastLyr(l.id), "visibility", vis);
      }
    }
  }

  // ── Penegakan urutan tumpukan ───────────────────────────────────────────────
  function syncOrder(force = false) {
    const map = mapRef.current;
    if (!map || !loadedRef.current || colorByRef.current) return;
    const sig = desiredOrderBottomUp().join("|");
    if (!force && sig === orderSigRef.current) return;
    orderSigRef.current = sig;
    enforceLayerOrder(map);
  }

  /** Satu siklus rekonsiliasi penuh: raster → vektor → urutan. */
  function syncAll() {
    syncRasterLayers();
    syncOverlayLayers();
    syncOrder();
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
    syncOrder(true);
  }

  // ── Render block layer ───────────────────────────────────────────────────────
  function renderBlocks() {
    const map = mapRef.current;
    const fc = dataRef.current;
    if (!map || !loadedRef.current || !fc) return;
    // Blok hanya dirender bila layer "blocks" aktif di panel (tidak ada di startup).
    if (!blocksLayer()) return;
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

      // Didaftarkan SEKALI seumur peta. Layer blok kini bisa dimatikan &
      // dihidupkan berulang kali dari panel; mendaftar ulang tiap kali akan
      // menumpuk handler dan memicu onSelect berkali-kali untuk satu klik.
      if (!clickBoundRef.current) {
        clickBoundRef.current = true;
        map.on("click", "blocks-fill", (e) => {
          const f = e.features?.[0];
          if (f && onSelectRef.current) onSelectRef.current(f.properties!.block_id as string);
        });
        map.on("mouseenter", "blocks-fill", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "blocks-fill", () => (map.getCanvas().style.cursor = ""));
      }
    }

    const b = new maplibregl.LngLatBounds();
    for (const feat of fc.features) {
      for (const ring of feat.geometry.coordinates) {
        for (const [lng, lat] of ring) b.extend([lng, lat]);
      }
    }
    if (!b.isEmpty() && interactive) map.fitBounds(b, { padding: 60, duration: 0 });
    apply3D();
    syncAll();
  }

  // ── Init map (sekali) ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: baseStyle(mapStore.getState().basemap),
      center: [111.705, -2.560],
      zoom: 11,
      interactive,
      attributionControl: false,
    });
    // Daftarkan sebagai peta utama agar tombol "zoom ke layer" & auto-zoom startup bekerja.
    if (interactive) registerMainMap(map);
    if (interactive) map.addControl(new maplibregl.NavigationControl({}), "top-left");

    // Kegagalan source (COG rusak, 404, CORS) dulu hanya muncul di console —
    // di layar layernya sekadar "tidak terlihat". Kini dilaporkan ke panel.
    if (interactive) {
      map.on("error", (e) => {
        const sourceId = (e as unknown as { sourceId?: string }).sourceId;
        if (!sourceId) return;
        const lid = sourceId.startsWith("rast-src-") ? sourceId.slice("rast-src-".length)
          : sourceId.startsWith("ov-src-") ? sourceId.slice("ov-src-".length)
          : null;
        if (!lid) return;
        const msg = (e as unknown as { error?: { message?: string } }).error?.message
          ?? "Gagal memuat sumber layer.";
        mapStore.setLayerError(lid, msg);
      });
    }

    map.on("load", () => {
      loadedRef.current = true;
      if (onMapLoad) onMapLoad(map);
      if (import.meta.env.DEV && interactive) (window as unknown as { __map?: maplibregl.Map }).__map = map;
      renderBlocks();
      syncAll();

      const active = mapStore.getState().activeLayers;
      const targetLyr = active.find((l) => l.kind === "reference") || active.find((l) => l.kind === "blocks");
      if (targetLyr && canZoomToLayer(targetLyr)) {
        zoomToLayer(targetLyr);
      }
    });
    mapRef.current = map;
    return () => {
      if (interactive) registerMainMap(null);
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
      overlayIdsRef.current.clear();
      rasterSigRef.current.clear();
      dataSigRef.current.clear();
      clickBoundRef.current = false;
      orderSigRef.current = "";
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
  useEffect(() => {
    renderBlocks();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Store subscription (basemap + simbologi blok + overlay layers + 3D) ─────
  useEffect(() => {
    let curBasemap = mapStore.getState().basemap;
    let cur3D = mapStore.getState().threeD;
    let curHasBlocks = mapStore.getState().activeLayers.some((l) => l.kind === "blocks");

    const removeAllBlocks = () => {
      const map = mapRef.current;
      if (!map) return;
      for (const lid of ["blocks-3d", "blocks-label", "blocks-fill", "blocks-line"]) {
        if (map.getLayer(lid)) map.removeLayer(lid);
      }
      if (map.getSource("blocks")) map.removeSource("blocks");
    };

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
        if (map && loadedRef.current) {
          applyBasemap(map, next);
          // Basemap disisipkan ulang di dasar style -> urutan wajib ditegakkan lagi.
          syncOrder(true);
        }
      }
      // Blocks symbology
      applyBlocksSymbology();
      // Block layer aktif/dinonaktifkan
      const hasBlocks = mapStore.getState().activeLayers.some((l) => l.kind === "blocks");
      if (hasBlocks !== curHasBlocks) {
        curHasBlocks = hasBlocks;
        if (hasBlocks) renderBlocks();
        else removeAllBlocks();
      }
      // Raster + vektor + urutan
      syncAll();
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

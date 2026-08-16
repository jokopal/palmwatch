import type maplibregl from "maplibre-gl";
import { mapStore, type ActiveLayer } from "../store/mapStore";

// ── Penamaan source/layer MapLibre milik PalmWatch ───────────────────────────
// Dikumpulkan di satu tempat supaya penegakan urutan (enforceLayerOrder) tahu
// persis layer mana yang ia miliki dan mana milik basemap/terrain.

export const ovSrc = (id: string) => `ov-src-${id}`;
export const ovFill = (id: string) => `ov-fill-${id}`;
export const ovLine = (id: string) => `ov-line-${id}`;
export const ovCircle = (id: string) => `ov-circle-${id}`;
export const ovLbl = (id: string) => `ov-lbl-${id}`;
export const rastSrc = (id: string) => `rast-src-${id}`;
export const rastLyr = (id: string) => `rast-${id}`;

/**
 * Semua id layer MapLibre yang MUNGKIN dimiliki satu ActiveLayer, urut bawah→atas.
 * Yang tidak ada di peta diabaikan saat penegakan urutan, jadi aman menyebut
 * semuanya tanpa perlu tahu tipe geometrinya di sini.
 */
export function mapLayerIdsFor(layer: ActiveLayer): string[] {
  if (layer.kind === "raster") return [rastLyr(layer.id)];
  if (layer.kind === "blocks") return ["blocks-fill", "blocks-3d", "blocks-line", "blocks-label"];
  return [ovFill(layer.id), ovLine(layer.id), ovCircle(layer.id), ovLbl(layer.id)];
}

/**
 * Kelas geometri dominan sebuah FeatureCollection.
 *
 * Menentukan JENIS layer MapLibre yang dipakai. Ini bukan detail kosmetik:
 * layer `fill` tidak menggambar apa pun untuk geometri Point, sehingga layer
 * titik (mis. hasil deteksi pohon, belasan ribu Point) tampak "hilang" padahal
 * datanya termuat sempurna.
 */
export type GeometryClass = "point" | "line" | "polygon";

export function geometryClassOf(fc: GeoJSON.FeatureCollection | undefined): GeometryClass {
  for (const f of fc?.features ?? []) {
    switch (f.geometry?.type) {
      case "Point":
      case "MultiPoint":
        return "point";
      case "LineString":
      case "MultiLineString":
        return "line";
      case "Polygon":
      case "MultiPolygon":
        return "polygon";
      default:
        continue; // GeometryCollection / null -> periksa fitur berikutnya
    }
  }
  return "polygon";
}

/**
 * Tegakkan urutan gambar MapLibre agar sama dengan urutan daftar layer.
 *
 * Store memakai konvensi QGIS: activeLayers[0] = paling ATAS. MapLibre
 * menggambar sesuai urutan penambahan, jadi tanpa fungsi ini tombol naik/turun
 * tidak berefek apa pun dan layer yang baru ditambahkan selalu menimpa yang
 * lama — penyebab utama keluhan "layer tidak terlihat".
 *
 * Raster COG selalu ditempatkan di bawah seluruh layer vektor (lihat catatan
 * konvensi di mapStore): satu DEM full-extent akan menutupi semua poligon.
 *
 * Basemap tidak pernah disentuh sehingga tetap paling bawah.
 *
 * @returns tanda tangan urutan yang diterapkan (untuk melewati kerja berulang)
 */
export function desiredOrderBottomUp(): string[] {
  const layers = mapStore.getState().activeLayers;
  const rasters = layers.filter((l) => l.kind === "raster");
  const vectors = layers.filter((l) => l.kind !== "raster");

  const out: string[] = [];
  // Dalam tiap band: indeks 0 = paling atas → dipasang paling akhir.
  for (const l of [...rasters].reverse()) out.push(...mapLayerIdsFor(l));
  for (const l of [...vectors].reverse()) out.push(...mapLayerIdsFor(l));
  return out;
}

// Debug hook (dev only) — senapas dengan __mapStore / __map di modul lain.
if (import.meta.env.DEV) {
  (window as unknown as { __layerOrder?: unknown }).__layerOrder = {
    desiredOrderBottomUp,
    mapLayerIdsFor,
    geometryClassOf,
  };
}

export function enforceLayerOrder(map: maplibregl.Map): void {
  // moveLayer(id) tanpa beforeId memindahkan layer ke paling atas. Dengan
  // memproses urutan bawah→atas, layer terakhir berakhir di puncak.
  for (const id of desiredOrderBottomUp()) {
    if (map.getLayer(id)) {
      try {
        map.moveLayer(id);
      } catch {
        /* layer sedang dibongkar — abaikan */
      }
    }
  }
}

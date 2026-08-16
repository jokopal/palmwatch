import manifest from "./rasterOverlays.json";
import type { AvailableLayer } from "./store/mapStore";

// ── Katalog overlay raster ───────────────────────────────────────────────────
//
// Sumber tunggal untuk raster yang bisa ditampilkan: manifest statis yang
// dibangun scripts/build_raster_overlays.py. Setiap entri sudah berupa PNG
// ber-alpha plus bbox, jadi menggambarnya di peta hanya perlu `image` source
// MapLibre — tidak ada decoder atau protokol yang bisa gagal diam-diam.
//
// Konsekuensi yang disengaja: raster yang baru diunggah TIDAK langsung muncul
// di sini; skrip harus dijalankan lebih dulu. Karena itu unggah raster dikunci
// di features.ts sampai langkah pemrosesan itu diotomatiskan.

export interface RasterOverlay {
  id: string;
  name: string;
  category: string;
  image: string;
  bounds: [number, number, number, number];
  minValue: number;
  maxValue: number;
  colormap: string;
  legend: string[];
  width: number;
  height: number;
}

const OVERLAYS = manifest as RasterOverlay[];

function toAvailable(o: RasterOverlay): AvailableLayer {
  return {
    id: `rast-${o.id}`,
    name: o.name,
    group: "raster",
    sourceRef: o.id,
    rasterConfig: {
      url: o.image,
      bounds: o.bounds,
      opacity: 0.85,
      colormap: o.colormap,
      minValue: o.minValue,
      maxValue: o.maxValue,
      legend: o.legend,
      category: o.category,
    },
  };
}

/** Semua overlay raster yang siap tampil, sudah urut per kategori lalu nama. */
export function listRasterOverlays(): AvailableLayer[] {
  return OVERLAYS.map(toAvailable);
}

export function findRasterOverlay(id: string): RasterOverlay | undefined {
  return OVERLAYS.find((o) => o.id === id);
}

/**
 * Cocokkan baris raster_layers dari database ke overlay yang siap tampil.
 *
 * Database tetap menjadi katalog "raster apa saja milik project ini", tapi yang
 * digambar selalu overlay PNG. Raster yang belum diproses skrip tidak punya
 * pasangan di sini dan sengaja dilewati — lebih baik hilang dari daftar
 * daripada muncul sebagai layer yang tak pernah tampil.
 */
export function overlayForName(name: string): AvailableLayer | undefined {
  const hit = OVERLAYS.find((o) => o.name === name);
  return hit ? toAvailable(hit) : undefined;
}

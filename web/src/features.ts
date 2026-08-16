// ── Feature flag ─────────────────────────────────────────────────────────────
//
// Aplikasi sedang dikejar tayang untuk preview client. Fitur yang belum benar
// -benar siap TIDAK boleh tampil seolah berfungsi lalu gagal di depan client.
//
// Tiga keadaan:
//   ready  — berfungsi penuh, tampil normal
//   locked — tampil tapi mati, dengan alasan yang jujur. Dipakai untuk fitur
//            yang ada di peta jalan; di depan client ini terbaca sebagai
//            rencana yang terkendali, bukan aplikasi yang kurang.
//   hidden — tidak dirender sama sekali. Untuk yang tak akan hadir dalam waktu
//            dekat, atau yang tak punya jalur teknis sama sekali.
//
// Cara melepas fitur: ubah state-nya di sini menjadi "ready". Tidak ada tempat
// lain yang perlu disentuh.

export type FeatureState = "ready" | "locked" | "hidden";

export type FeatureKey =
  | "geeLayers"
  | "analysis"
  | "temporalTab"
  | "conclusionTab"
  | "insets"
  | "productionData"
  | "rasterUpload"
  | "threeD";

interface FeatureDef {
  state: FeatureState;
  /** Alasan yang ditampilkan ke pengguna saat fitur terkunci. */
  reason: string;
}

const FEATURES: Record<FeatureKey, FeatureDef> = {
  // Tidak punya pipeline tile sama sekali — tak ada yang bisa digambar.
  geeLayers: {
    state: "hidden",
    reason: "Layer GEE membutuhkan pipeline tile yang belum dibangun.",
  },

  // RPC-nya ada dan lulus uji, tapi blok nyata belum punya data kondisi/EO,
  // sehingga hasilnya akan kosong atau menyesatkan.
  analysis: {
    state: "locked",
    reason: "Analisis dibuka setelah data kondisi & EO untuk kebun ini lengkap.",
  },

  temporalTab: {
    state: "locked",
    reason: "Perbandingan antarwaktu butuh minimal dua periode layer. Belum tersedia.",
  },

  conclusionTab: {
    state: "locked",
    reason: "Kesimpulan diturunkan dari hasil analisis yang belum dijalankan.",
  },

  // Inset diwarnai per variabel EO; tanpa data EO hasilnya kotak abu-abu.
  insets: {
    state: "locked",
    reason: "Peta inset butuh data EO per blok yang belum tersedia.",
  },

  productionData: {
    state: "locked",
    reason: "Input data produksi belum dibuka pada rilis preview ini.",
  },

  // Raster tampil dari overlay PNG yang dibangun skrip
  // scripts/build_raster_overlays.py, jadi unggahan baru belum langsung tampil.
  rasterUpload: {
    state: "locked",
    reason: "Raster baru perlu diproses lebih dulu lewat build_raster_overlays.py.",
  },

  threeD: { state: "ready", reason: "" },
};

export const featureState = (k: FeatureKey): FeatureState => FEATURES[k].state;
export const isReady = (k: FeatureKey): boolean => FEATURES[k].state === "ready";
export const isHidden = (k: FeatureKey): boolean => FEATURES[k].state === "hidden";
export const isLocked = (k: FeatureKey): boolean => FEATURES[k].state === "locked";
export const lockReason = (k: FeatureKey): string => FEATURES[k].reason;

/**
 * Props standar untuk kontrol yang terkunci.
 *
 * Sengaja TIDAK mengembalikan className: pemanggil punya kelas tata letaknya
 * sendiri (bp-tab, map-tool, ...) dan menambahkan "is-locked" di sana, sehingga
 * urutan spread tidak pernah diam-diam menimpa kelas milik siapa pun.
 */
export function lockedProps(k: FeatureKey): { disabled: boolean; title: string } {
  return { disabled: true, title: lockReason(k) };
}

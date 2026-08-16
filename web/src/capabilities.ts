// ── Kapabilitas per role ─────────────────────────────────────────────────────
//
// SATU sumber kebenaran untuk "siapa boleh apa" di UI. Sebelumnya keputusan ini
// tersebar sebagai `isAdmin &&` di belasan tempat, sehingga satu titik yang
// terlewat langsung membocorkan kontrol admin ke viewer.
//
// Ini murni lapisan UX. Penegakan sebenarnya tetap di database (RLS + guard
// di dalam RPC). Komponen TIDAK BOLEH memeriksa role secara langsung —
// selalu lewat kapabilitas, supaya penambahan role baru cukup diubah di sini.

export type Role = "loading" | "guest" | "user" | "admin";

export interface Capabilities {
  /** Ubah simbologi, urutan, visibilitas, dan hapus layer aktif. */
  editLayers: boolean;
  /** Unggah data (SHP/GeoJSON/raster) ke database. */
  uploadData: boolean;
  /** Simpan konfigurasi diagnostik reference layer ke database. */
  saveLayerConfig: boolean;
  /** Jalankan analisis dan simpan hasilnya. */
  runAnalysis: boolean;
  /** Kelola akun pengguna dan keanggotaan project. */
  manageUsers: boolean;
  /** Buat project baru dan ubah status publiknya. */
  manageProjects: boolean;
  /** Lihat panel data (tabel atribut, detail blok). */
  viewDataPanels: boolean;
}

const NOTHING: Capabilities = {
  editLayers: false,
  uploadData: false,
  saveLayerConfig: false,
  runAnalysis: false,
  manageUsers: false,
  manageProjects: false,
  viewDataPanels: false,
};

/**
 * Turunkan kapabilitas dari role.
 *
 * `loading` sengaja tidak memberi izin apa pun: selama role belum diketahui,
 * UI menampilkan versi paling terbatas. Ini mencegah kontrol admin berkedip
 * muncul lalu hilang — dan lebih aman daripada menebak ke atas.
 */
export function capabilitiesFor(role: Role): Capabilities {
  switch (role) {
    case "admin":
      return {
        editLayers: true,
        uploadData: true,
        saveLayerConfig: true,
        runAnalysis: true,
        manageUsers: true,
        manageProjects: true,
        viewDataPanels: true,
      };
    case "user":
      return { ...NOTHING, viewDataPanels: true };
    case "guest":
    case "loading":
    default:
      return NOTHING;
  }
}

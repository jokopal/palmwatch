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
  /**
   * Ubah tampilan layer yang SUDAH aktif: simbologi, urutan tumpukan, dan
   * visibilitas. Ini pekerjaan lokal di browser dan tidak menulis apa pun ke
   * database, jadi anggota project pun boleh melakukannya — mereka mengatur
   * cara melihat, bukan mengubah data.
   */
  styleLayers: boolean;
  /**
   * Ubah SUSUNAN layer aktif: menambah dari katalog, menghapus dari daftar.
   * Sengaja dipisah dari styleLayers. Anggota project menerima susunan yang
   * dipublikasikan admin; kalau mereka bisa menghapus layer, tak ada jalan
   * untuk menambahkannya kembali karena katalog tidak mereka miliki.
   */
  manageLayerSet: boolean;
  /** Publikasikan susunan layer aktif sebagai titik awal bagi anggota project. */
  publishLayers: boolean;
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
  styleLayers: false,
  manageLayerSet: false,
  publishLayers: false,
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
        styleLayers: true,
        manageLayerSet: true,
        publishLayers: true,
        uploadData: true,
        saveLayerConfig: true,
        runAnalysis: true,
        manageUsers: true,
        manageProjects: true,
        viewDataPanels: true,
      };
    case "user":
      // Anggota project boleh mengatur CARA MELIHAT (simbologi, urutan,
      // nyala/mati), tapi tidak boleh mengubah SUSUNANNYA — layer apa saja yang
      // ada ditentukan admin lewat publikasi.
      return { ...NOTHING, styleLayers: true, viewDataPanels: true };
    case "guest":
    case "loading":
    default:
      return NOTHING;
  }
}

// Skema warna geomatico untuk raster COG single-band (butuh min/max).
// Dipakai bersama oleh tab Upload (saat mendaftarkan raster) dan panel properti
// layer (saat mengubah tampilan raster yang sudah aktif) — sebelumnya daftar ini
// hanya ada di UploadTab sehingga colormap tak bisa diubah setelah diunggah.
export const RASTER_COLORMAPS: { value: string; label: string }[] = [
  { value: "", label: "RGB / apa adanya" },
  { value: "BrewerYlGn9", label: "Vegetasi (kuning→hijau)" },
  { value: "BrewerYlGnBu9", label: "Drainase/air (kuning→biru)" },
  { value: "BrewerYlOrRd9", label: "Suhu (kuning→merah)" },
  { value: "BrewerSpectral9", label: "Spektral (umum)" },
];

export const RASTER_CATEGORIES = ["dem", "soil", "rainfall", "twi", "ndvi", "other"];

/** Gradien CSS pendekatan untuk swatch legenda tiap skema. */
export const COLORMAP_GRADIENT: Record<string, string> = {
  BrewerYlGn9: "linear-gradient(90deg,#ffffe5,#addd8e,#238443)",
  BrewerYlGnBu9: "linear-gradient(90deg,#ffffd9,#7fcdbb,#253494)",
  BrewerYlOrRd9: "linear-gradient(90deg,#ffffcc,#fd8d3c,#800026)",
  BrewerSpectral9: "linear-gradient(90deg,#d53e4f,#ffffbf,#3288bd)",
};

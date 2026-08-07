interface Props {
  /** Teks status; default untuk pemuatan data blok. */
  label?: string;
}

/**
 * Indikator pemuatan ringan di atas peta.
 *
 * Dipakai selagi FeatureCollection blok belum tiba (RPC blocks_geojson).
 * Sebelumnya peta hanya tampil kosong tanpa penjelasan sehingga tak bisa
 * dibedakan dari "project ini memang belum punya blok".
 */
export default function LoadingOverlay({ label = "Memuat data blok…" }: Props) {
  return (
    <div className="map-loading" role="status" aria-live="polite">
      <span className="map-loading-dots" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span className="map-loading-label">{label}</span>
    </div>
  );
}

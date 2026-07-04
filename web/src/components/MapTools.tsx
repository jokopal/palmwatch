import { mapStore, useMapStore } from "../store/mapStore";

// Toolbar peta di kiri (berdekatan dengan kontrol zoom/pan MapLibre): kelola inset.
export default function MapTools() {
  const insetsEnabled = useMapStore((s) => s.insetsEnabled);
  const count = useMapStore((s) => s.insets.length);

  return (
    <div className="map-tools">
      <button
        className={`map-tool${insetsEnabled ? " active" : ""}`}
        onClick={() => mapStore.setInsetsEnabled(!insetsEnabled)}
        title={insetsEnabled ? "Sembunyikan inset" : "Tampilkan inset"}
      >
        ▣
      </button>
      <button
        className="map-tool"
        onClick={() => mapStore.addInset()}
        disabled={!insetsEnabled || count >= mapStore.MAX_INSETS}
        title={`Tambah inset (${count}/${mapStore.MAX_INSETS})`}
      >
        ＋
      </button>
    </div>
  );
}

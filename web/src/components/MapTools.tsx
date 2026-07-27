import { mapStore, useMapStore } from "../store/mapStore";

// Toolbar peta di kiri (berdekatan dengan kontrol zoom/pan MapLibre): kelola inset.
export default function MapTools() {
  const insetsEnabled = useMapStore((s) => s.insetsEnabled);
  const count = useMapStore((s) => s.insets.length);
  const threeD = useMapStore((s) => s.threeD);
  const hasRaster = useMapStore((s) => s.activeLayers.some((l) => l.kind === "raster"));
  const clip = useMapStore((s) => s.clipRasterToBoundary);

  return (
    <div className="map-tools">
      {hasRaster && (
        <button
          className={`map-tool${clip ? " active" : ""}`}
          onClick={() => mapStore.setClipRasterToBoundary(!clip)}
          title={clip
            ? "Raster di-clip ke batas blok (klik untuk tampilkan penuh)"
            : "Clip raster ke batas blok — fokus AOI, render lebih ringan"}
        >
          ✂
        </button>
      )}
      <button
        className={`map-tool${threeD ? " active" : ""}`}
        onClick={() => mapStore.setThreeD(!threeD)}
        title={threeD ? "Kembali ke 2D" : "Mode 3D (terrain + ekstrusi)"}
      >
        {threeD ? "2D" : "3D"}
      </button>
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

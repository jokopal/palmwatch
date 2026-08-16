import { mapStore, useMapStore } from "../store/mapStore";
import { isLocked, isReady, lockedProps } from "../features";

// Toolbar peta di kiri (berdekatan dengan kontrol zoom/pan MapLibre).
//
// Tombol clip raster (✂) sudah dilepas: raster kini digambar sebagai overlay
// PNG lewat `image` source MapLibre, yang tidak mengenal masking global seperti
// protokol COG dulu. Pemotongan ke AOI dilakukan saat overlay dibangun.
export default function MapTools() {
  const insetsEnabled = useMapStore((s) => s.insetsEnabled);
  const count = useMapStore((s) => s.insets.length);
  const threeD = useMapStore((s) => s.threeD);

  const insetsOn = isReady("insets");

  return (
    <div className="map-tools">
      {isReady("threeD") && (
        <button
          className={`map-tool${threeD ? " active" : ""}`}
          onClick={() => mapStore.setThreeD(!threeD)}
          title={threeD ? "Kembali ke 2D" : "Mode 3D (terrain + ekstrusi)"}
        >
          {threeD ? "2D" : "3D"}
        </button>
      )}

      {/* Inset tetap terlihat walau terkunci: pengguna tahu fiturnya ada dan
          kenapa belum bisa dipakai, alih-alih mengira tombolnya hilang. */}
      {insetsOn ? (
        <>
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
        </>
      ) : (
        isLocked("insets") && (
          <button className="map-tool is-locked" {...lockedProps("insets")}>
            ▣
          </button>
        )
      )}
    </div>
  );
}

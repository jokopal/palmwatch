import { useEffect } from "react";
import LayersTab from "./LayersTab";
import UploadTab from "./UploadTab";
import { mapStore, useMapStore, type AvailableLayer } from "../store/mapStore";
import { listVectorLayers, getVectorLayerGeojson } from "../vectorLayers";

interface Props {
  // Upload butuh sesi terautentikasi (RLS: insert utk authenticated). Bukan
  // sekadar role admin — cukup login agar tidak terblokir metadata role.
  canUpload: boolean;
}

// Panel kiri bertab: "Layers" (manajemen + simbologi) & "Upload" (SHP/GeoJSON->DB).
export default function LeftPanel({ canUpload }: Props) {
  const tab = useMapStore((s) => s.leftTab);

  // Muat daftar layer DB sekali di awal.
  useEffect(() => {
    listVectorLayers().then(mapStore.setDbLayers).catch(() => {});
  }, []);

  const handleAddDb = async (a: AvailableLayer) => {
    if (!a.sourceRef) return;
    const geojson = await getVectorLayerGeojson(a.sourceRef);
    if (geojson) mapStore.addDbLayer(a, geojson);
  };

  return (
    <div className="left-panel">
      <div className="left-tabs">
        <button className={`left-tab${tab === "layers" ? " active" : ""}`} onClick={() => mapStore.setLeftTab("layers")}>
          ▤ Layers
        </button>
        <button
          className={`left-tab${tab === "upload" ? " active" : ""}`}
          onClick={() => mapStore.setLeftTab("upload")}
          disabled={!canUpload}
          title={canUpload ? "Upload layer ke database" : "Login untuk mengupload"}
        >
          ⭱ Upload
        </button>
      </div>

      <div className="left-tab-body">
        {tab === "layers" ? (
          <LayersTab onAddDb={handleAddDb} />
        ) : (
          <UploadTab onClose={() => mapStore.setLeftTab("layers")} />
        )}
      </div>
    </div>
  );
}

import { useEffect } from "react";
import LayersTab from "./LayersTab";
import UploadTab from "./UploadTab";
import { mapStore, useMapStore, type AvailableLayer } from "../store/mapStore";
import { listReferenceLayers } from "../analysisApi";
import { getVectorLayerGeojson } from "../vectorLayers";
import { listRasterLayers } from "../rasterLayers";

interface Props {
  canUpload: boolean;
  projectId: string | null;
  onBlocksImported?: () => void;
}

// Panel kiri bertab: "Layers" + "Upload".
// Muat daftar DB layers termasuk reference layers dengan metadata lengkap.
export default function LeftPanel({ canUpload, projectId, onBlocksImported }: Props) {
  const tab = useMapStore((s) => s.leftTab);

  // Muat semua layer DB (reference + generic) sekali di awal dan setelah upload
  const loadDbLayers = () => {
    listReferenceLayers(projectId ?? undefined).then(mapStore.setDbLayers).catch(() => {});
    listRasterLayers(projectId).then(mapStore.setRasterLayers).catch(() => {});
  };

  useEffect(() => {
    loadDbLayers();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddDb = async (a: AvailableLayer) => {
    if (!a.sourceRef) return;
    const geojson = await getVectorLayerGeojson(a.sourceRef);
    if (geojson) mapStore.addDbLayer(a, geojson);
  };

  return (
    <div className="left-panel">
      <div className="left-tabs">
        <button
          className={`left-tab${tab === "layers" ? " active" : ""}`}
          onClick={() => mapStore.setLeftTab("layers")}
        >
          Layers
        </button>
        <button
          className={`left-tab${tab === "upload" ? " active" : ""}`}
          onClick={() => mapStore.setLeftTab("upload")}
          disabled={!canUpload}
          title={canUpload ? "Upload data ke database" : "Login untuk mengupload"}
        >
          Upload
        </button>
      </div>

      <div className="left-tab-body">
        {tab === "layers" ? (
          <LayersTab onAddDb={handleAddDb} />
        ) : (
          <UploadTab
            onClose={() => mapStore.setLeftTab("layers")}
            projectId={projectId}
            onImported={onBlocksImported}
            onRefLayersChanged={() => { loadDbLayers(); mapStore.setLeftTab("layers"); }}
            onRastersChanged={() => { loadDbLayers(); mapStore.setLeftTab("layers"); }}
          />
        )}
      </div>
    </div>
  );
}

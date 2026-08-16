import { useEffect } from "react";
import LayersTab from "./LayersTab";
import UploadTab from "./UploadTab";
import { mapStore, useMapStore, type AvailableLayer } from "../store/mapStore";
import { listReferenceLayers } from "../analysisApi";
import { getVectorLayerGeojson } from "../vectorLayers";
import { listRasterLayers } from "../rasterLayers";
import { zoomToLayer } from "../map/zoomToLayer";

interface Props {
  canUpload: boolean;
  projectId: string | null;
  onBlocksImported?: () => void;
}

// Panel kiri bertab: "Layers" + "Upload".
// Muat daftar DB layers termasuk reference layers dengan metadata lengkap.
export default function LeftPanel({ canUpload, projectId, onBlocksImported }: Props) {
  const tab = useMapStore((s) => s.leftTab);

  // Muat semua layer DB (reference + generic) sekali di awal dan setelah upload.
  // Startup: auto-tambah + zoom ke reference layer terbaru (tidak ada default layer).
  useEffect(() => {
    let cancelled = false;

    listReferenceLayers(projectId ?? undefined).then((layers) => {
      if (cancelled) return;
      mapStore.setDbLayers(layers);

      const refs = layers.filter((l) => l.layerRole === "reference");
      const latest = refs[0]; // API sudah order created_at desc → terbaru di index 0
      if (latest?.sourceRef) {
        const existing = mapStore.getState().activeLayers.find(
          (l) => l.sourceRef === latest.sourceRef,
        );
        if (existing) {
          zoomToLayer(existing);
        } else {
          getVectorLayerGeojson(latest.sourceRef).then((g) => {
            if (cancelled || !g) return;
            mapStore.addDbLayer(latest, g);
            const added = mapStore.getState().activeLayers.find(
              (l) => l.sourceRef === latest.sourceRef,
            );
            if (added) zoomToLayer(added);
          }).catch(() => {});
        }
      } else {
        const blk = mapStore.getState().activeLayers.find((l) => l.kind === "blocks");
        if (blk) zoomToLayer(blk);
      }
    }).catch(() => {});

    listRasterLayers(projectId).then(mapStore.setRasterLayers).catch(() => {});

    return () => { cancelled = true; };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddDb = async (a: AvailableLayer) => {
    if (!a.sourceRef) return;
    const geojson = await getVectorLayerGeojson(a.sourceRef);
    if (geojson) mapStore.addDbLayer(a, geojson);
  };

  const reloadDbLayers = () => {
    listReferenceLayers(projectId ?? undefined).then(mapStore.setDbLayers).catch(() => {});
    listRasterLayers(projectId).then(mapStore.setRasterLayers).catch(() => {});
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
            onRefLayersChanged={() => { reloadDbLayers(); mapStore.setLeftTab("layers"); }}
            onRastersChanged={() => { reloadDbLayers(); mapStore.setLeftTab("layers"); }}
          />
        )}
      </div>
    </div>
  );
}

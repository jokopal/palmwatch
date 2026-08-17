import { useEffect, useState } from "react";
import LayersTab from "./LayersTab";
import UploadTab from "./UploadTab";
import { mapStore, useMapStore, type AvailableLayer } from "../store/mapStore";
import { listReferenceLayers } from "../analysisApi";
import { getVectorLayerGeojson } from "../vectorLayers";
import { listRasterOverlays } from "../rasterOverlays";
import { zoomToLayer } from "../map/zoomToLayer";
import { useCapabilities } from "../auth";
import { fetchPublishedView, applyPublishedView } from "../publishedLayers";

interface Props {
  projectId: string | null;
  onBlocksImported?: () => void;
}

// Panel kiri bertab: "Layers" + "Upload".
//
// Dua jalur pemuatan, sesuai kapabilitas:
//   admin   -> katalog layer DB, mulai dari kanvas bersih, susun sendiri
//   anggota -> susunan yang DIPUBLIKASIKAN admin; tanpa katalog, tanpa upload
export default function LeftPanel({ projectId, onBlocksImported }: Props) {
  const tab = useMapStore((s) => s.leftTab);
  const caps = useCapabilities();
  const [loadingPublished, setLoadingPublished] = useState(false);
  const [publishedNote, setPublishedNote] = useState<string | null>(null);

  // ── Jalur anggota: pulihkan susunan terpublikasi ───────────────────────────
  useEffect(() => {
    if (caps.manageLayerSet || !projectId) return;
    let cancelled = false;
    setLoadingPublished(true);
    setPublishedNote(null);

    (async () => {
      const view = await fetchPublishedView(projectId);
      if (cancelled) return;

      if (!view) {
        // Belum pernah dipublikasikan: tampilkan batas blok saja supaya peta
        // tidak kosong, dan katakan apa adanya.
        mapStore.addBlocksLayer();
        setPublishedNote("Admin belum memublikasikan susunan layer untuk project ini.");
        setLoadingPublished(false);
        return;
      }

      const n = await applyPublishedView(view);
      if (cancelled) return;
      if (n === 0) {
        mapStore.addBlocksLayer();
        setPublishedNote("Susunan terpublikasi kosong.");
      }
      const first = mapStore.getState().activeLayers.find((l) => l.visible);
      if (first) zoomToLayer(first);
      setLoadingPublished(false);
    })();

    return () => { cancelled = true; };
  }, [projectId, caps.manageLayerSet]);

  // ── Jalur admin: katalog layer DB + zoom ke reference terbaru ──────────────
  useEffect(() => {
    if (!caps.manageLayerSet) return;
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

    mapStore.setRasterLayers(listRasterOverlays());

    return () => { cancelled = true; };
  }, [projectId, caps.manageLayerSet]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddDb = async (a: AvailableLayer) => {
    if (!a.sourceRef) return;
    const geojson = await getVectorLayerGeojson(a.sourceRef);
    if (geojson) mapStore.addDbLayer(a, geojson);
  };

  const reloadDbLayers = () => {
    listReferenceLayers(projectId ?? undefined).then(mapStore.setDbLayers).catch(() => {});
    mapStore.setRasterLayers(listRasterOverlays());
  };

  return (
    <div className="left-panel">
      {/* Tab Upload disembunyikan sepenuhnya bila tak punya izin. Dulu ia hanya
          dinonaktifkan — anggota melihat tab yang selamanya mati. */}
      {caps.uploadData && (
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
          >
            Upload
          </button>
        </div>
      )}

      <div className="left-tab-body">
        {loadingPublished && (
          <div className="lp-loading-note">Memuat susunan layer dari admin…</div>
        )}
        {publishedNote && <div className="lp-msg warn">{publishedNote}</div>}

        {caps.uploadData && tab === "upload" ? (
          <UploadTab
            onClose={() => mapStore.setLeftTab("layers")}
            projectId={projectId}
            onImported={onBlocksImported}
            onRefLayersChanged={() => { reloadDbLayers(); mapStore.setLeftTab("layers"); }}
            onRastersChanged={() => { reloadDbLayers(); mapStore.setLeftTab("layers"); }}
          />
        ) : (
          <LayersTab onAddDb={handleAddDb} projectId={projectId} />
        )}
      </div>
    </div>
  );
}

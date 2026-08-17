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
import UserPanel from "./UserPanel";
import type { Project } from "../projects";
import type { Summary } from "../types";

interface Props {
  projectId: string | null;
  onBlocksImported?: () => void;
  /** Ringkasan kebun untuk tab Info (anggota project). */
  project?: Project;
  summary?: Summary | null;
}

// Panel kiri bertab: "Layers" + "Upload".
//
// Dua jalur pemuatan, sesuai kapabilitas:
//   admin   -> katalog layer DB, mulai dari kanvas bersih, susun sendiri
//   anggota -> susunan yang DIPUBLIKASIKAN admin; tanpa katalog, tanpa upload
export default function LeftPanel({ projectId, onBlocksImported, project, summary }: Props) {
  const tab = useMapStore((s) => s.leftTab);
  const caps = useCapabilities();
  const [loadingPublished, setLoadingPublished] = useState(false);
  const [publishedNote, setPublishedNote] = useState<string | null>(null);

  // Tab "info" hanya ada untuk anggota; admin yang membuka sesi dengan tab itu
  // tersimpan akan melihat badan panel kosong.
  useEffect(() => {
    if (caps.uploadData && tab === "info") mapStore.setLeftTab("layers");
  }, [caps.uploadData, tab]);

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

  // ── Jalur admin: katalog + PULIHKAN susunan terpublikasi ───────────────────
  //
  // Admin dulu selalu mulai dari kanvas bersih, jadi susunan yang sudah susah
  // payah diatur dan dipublikasikan hilang begitu halaman dimuat ulang —
  // publikasi terasa seperti aksi tanpa jejak. Sekarang susunan terpublikasi
  // adalah keadaan tersimpan bagi SEMUA orang, admin termasuk.
  useEffect(() => {
    if (!caps.manageLayerSet) return;
    let cancelled = false;

    mapStore.setRasterLayers(listRasterOverlays());

    (async () => {
      // Katalog di-await lebih dulu: cabang fallback di bawah membacanya dari
      // store, dan tanpa await ia akan membaca daftar yang masih kosong.
      const catalog = await listReferenceLayers(projectId ?? undefined).catch(() => []);
      if (cancelled) return;
      mapStore.setDbLayers(catalog);

      if (!projectId) return;
      setLoadingPublished(true);
      const view = await fetchPublishedView(projectId);
      if (cancelled) { setLoadingPublished(false); return; }

      if (view && view.layers.length > 0) {
        const n = await applyPublishedView(view);
        if (cancelled) return;
        setPublishedNote(
          `Memuat ${n} layer dari susunan terpublikasi terakhir. ` +
          `Ubah lalu tekan Publikasikan untuk menyimpan.`,
        );
        const first = mapStore.getState().activeLayers.find((l) => l.visible);
        if (first) zoomToLayer(first);
        setLoadingPublished(false);
        return;
      }

      // Belum pernah dipublikasikan: perilaku lama — tarik reference terbaru
      // supaya peta tidak kosong sama sekali saat pertama kali dibuka.
      setLoadingPublished(false);
      const latest = catalog.filter((l) => l.layerRole === "reference")[0];
      if (!latest?.sourceRef) {
        const blk = mapStore.getState().activeLayers.find((l) => l.kind === "blocks");
        if (blk) zoomToLayer(blk);
        return;
      }
      const existing = mapStore.getState().activeLayers.find((l) => l.sourceRef === latest.sourceRef);
      if (existing) { zoomToLayer(existing); return; }
      const g = await getVectorLayerGeojson(latest.sourceRef).catch(() => null);
      if (cancelled || !g) return;
      mapStore.addDbLayer(latest, g);
      const added = mapStore.getState().activeLayers.find((l) => l.sourceRef === latest.sourceRef);
      if (added) zoomToLayer(added);
    })();

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
      {/* Tab Upload disembunyikan sepenuhnya bila tak punya izin — dulu ia hanya
          dinonaktifkan, jadi anggota melihat tab yang selamanya mati.
          Anggota mendapat tab "Info" berisi ringkasan kebun sebagai gantinya.

          Info ditaruh sebagai TAB, bukan ditumpuk di atas daftar layer:
          .user-panel dan .left-panel sama-sama menuntut height:100%, sehingga
          menumpuknya membuat panel bawah terdorong keluar layar sepenuhnya. */}
      <div className="left-tabs">
        <button
          className={`left-tab${tab === "layers" ? " active" : ""}`}
          onClick={() => mapStore.setLeftTab("layers")}
        >
          Layer
        </button>
        {caps.uploadData ? (
          <button
            className={`left-tab${tab === "upload" ? " active" : ""}`}
            onClick={() => mapStore.setLeftTab("upload")}
          >
            Upload
          </button>
        ) : (
          <button
            className={`left-tab${tab === "info" ? " active" : ""}`}
            onClick={() => mapStore.setLeftTab("info")}
          >
            Info Kebun
          </button>
        )}
      </div>

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
        ) : !caps.uploadData && tab === "info" ? (
          <UserPanel project={project} summary={summary ?? null} embedded />
        ) : (
          <LayersTab onAddDb={handleAddDb} projectId={projectId} />
        )}
      </div>
    </div>
  );
}

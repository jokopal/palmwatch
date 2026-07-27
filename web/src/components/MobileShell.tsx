import { useState } from "react";
import type maplibregl from "maplibre-gl";
import MapView from "./MapView";
import MapTools from "./MapTools";
import BasemapSwitcher from "./BasemapSwitcher";
import FloatingLegend from "./FloatingLegend";
import LeftPanel from "./LeftPanel";
import UserPanel from "./UserPanel";
import BottomPanel from "./BottomPanel";
import AnalysisBar from "./AnalysisBar";
import MobileSheet from "./MobileSheet";
import type { Project } from "../projects";
import type { BlockCollection, Summary } from "../types";

type Tab = "map" | "panel" | "analysis";

interface Props {
  data: BlockCollection | null;
  summary: Summary | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  projects: Project[];
  projectId: string | null;
  isAdmin: boolean;
  error: string | null;
  onMapLoad: (map: maplibregl.Map) => void;
  onBlocksImported: () => void;
}

/**
 * Layout mobile/tablet-portrait: peta layar-penuh + bottom-sheet + tab bar bawah.
 * Menggunakan ulang komponen yang sama dengan desktop (MapView, LeftPanel,
 * UserPanel, BottomPanel, AnalysisBar) — hanya penataannya yang berbeda.
 */
export default function MobileShell({
  data, summary, selectedId, onSelect, projects, projectId,
  isAdmin, error, onMapLoad, onBlocksImported,
}: Props) {
  const [tab, setTab] = useState<Tab>("map");
  const [expanded, setExpanded] = useState(false);

  const openTab = (t: Tab) => {
    if (t === "map") { setTab("map"); return; }
    setTab(t);
  };
  const closeSheet = () => { setTab("map"); setExpanded(false); };

  // Buka sheet Analisis otomatis saat blok dipilih dari peta.
  const handleSelect = (id: string) => {
    onSelect(id);
    if (tab === "map") setTab("analysis");
  };

  const panelTitle = isAdmin ? "Layer & Data" : "Info Kebun";
  const activeProject = projects.find((p) => p.id === projectId);

  return (
    <div className="m-shell">
      <div className="m-map">
        <MapView data={data} selectedId={selectedId} onSelect={handleSelect} onMapLoad={onMapLoad} />
        <MapTools />
        <BasemapSwitcher />
        <FloatingLegend />
        {error && <div className="m-map-error">API error: {error}</div>}
      </div>

      {/* Panel Layer/Info */}
      <MobileSheet
        open={tab === "panel"}
        title={panelTitle}
        expanded={expanded}
        onToggleExpand={() => setExpanded((v) => !v)}
        onClose={closeSheet}
      >
        {isAdmin ? (
          <LeftPanel canUpload={isAdmin} projectId={projectId} onBlocksImported={onBlocksImported} />
        ) : (
          <UserPanel project={activeProject} summary={summary} />
        )}
      </MobileSheet>

      {/* Panel Analisis */}
      <MobileSheet
        open={tab === "analysis"}
        title="Analisis"
        expanded={expanded}
        onToggleExpand={() => setExpanded((v) => !v)}
        onClose={closeSheet}
      >
        {isAdmin && <AnalysisBar projectId={projectId} />}
        <BottomPanel data={data} selectedId={selectedId} onSelect={onSelect} />
      </MobileSheet>

      {/* Tab bar bawah */}
      <nav className="m-tabbar">
        <button className={`m-tab ${tab === "map" ? "active" : ""}`} onClick={() => openTab("map")}>
          <span className="m-tab-icon">🗺️</span><span className="m-tab-label">Peta</span>
        </button>
        <button className={`m-tab ${tab === "panel" ? "active" : ""}`} onClick={() => openTab("panel")}>
          <span className="m-tab-icon">{isAdmin ? "🧩" : "📋"}</span>
          <span className="m-tab-label">{isAdmin ? "Layer" : "Info"}</span>
        </button>
        <button className={`m-tab ${tab === "analysis" ? "active" : ""}`} onClick={() => openTab("analysis")}>
          <span className="m-tab-icon">📊</span><span className="m-tab-label">Analisis</span>
        </button>
      </nav>
    </div>
  );
}

import { useState } from "react";
import { GEE_AVAILABLE, mapStore, useMapStore, type AvailableLayer } from "../store/mapStore";
import SymbologyPanel from "./SymbologyPanel";

interface Props {
  onAddDb: (a: AvailableLayer) => void;
}

// Tab "Layers": manajemen layer aktif (multi-select ala QGIS). Simbologi diedit
// per-layer lewat icon ✎ pada baris layer (inline), bukan section terpisah.
export default function LayersTab({ onAddDb }: Props) {
  const activeLayers = useMapStore((s) => s.activeLayers);
  const dbLayers = useMapStore((s) => s.dbLayers);
  const [editingId, setEditingId] = useState<string | null>(null);

  const activeRefs = new Set(activeLayers.map((l) => l.sourceRef));

  const toggleEdit = (id: string) => {
    setEditingId((cur) => {
      const next = cur === id ? null : id;
      if (next) mapStore.selectLayer(id);
      return next;
    });
  };

  return (
    <div className="layers-tab">
      {/* ACTIVE LAYERS (multi-select, edit simbologi per baris) */}
      <div className="sidebar-section">
        <h3 className="sidebar-title">Active Layers</h3>
        <ul className="active-layer-list">
          {activeLayers.map((l, idx) => (
            <li key={l.id} className="active-layer-item">
              <div className={`active-layer${editingId === l.id ? " selected" : ""}`}>
                <input
                  type="checkbox"
                  checked={l.visible}
                  onChange={() => mapStore.toggleLayerVisible(l.id)}
                  title="Toggle visibility"
                />
                <span className={`layer-kind-dot k-${l.kind}`} />
                <span className="active-layer-name">{l.name}</span>
                <span className="layer-actions">
                  <button
                    className={`layer-edit${editingId === l.id ? " on" : ""}`}
                    onClick={() => toggleEdit(l.id)}
                    title="Edit simbologi"
                  >
                    ✎
                  </button>
                  <button disabled={idx === 0} onClick={() => mapStore.reorderLayer(l.id, -1)} title="Move up">↑</button>
                  <button disabled={idx === activeLayers.length - 1} onClick={() => mapStore.reorderLayer(l.id, 1)} title="Move down">↓</button>
                  {l.kind !== "blocks" && (
                    <button onClick={() => { mapStore.removeLayer(l.id); if (editingId === l.id) setEditingId(null); }} title="Remove">✕</button>
                  )}
                </span>
              </div>
              {editingId === l.id && (
                <div className="layer-sym-editor">
                  <SymbologyPanel />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* AVAILABLE LAYERS: GEE + DB */}
      <div className="sidebar-section" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <h3 className="sidebar-title">Available Layers</h3>

        <div className="avail-group-title">GEE Sources</div>
        <ul className="layer-list">
          {GEE_AVAILABLE.map((a) => (
            <li key={a.id}>
              <span>{a.name}</span>
              <button
                className="add-layer-btn"
                disabled={activeRefs.has(a.sourceRef)}
                onClick={() => mapStore.addAvailableLayer(a)}
              >
                {activeRefs.has(a.sourceRef) ? "ADDED" : "+ ADD"}
              </button>
            </li>
          ))}
        </ul>

        <div className="avail-group-title">Database Sources</div>
        {dbLayers.length === 0 ? (
          <div className="avail-empty">Belum ada layer di database. Buka tab <b>Upload</b> untuk menambah SHP/GeoJSON.</div>
        ) : (
          <ul className="layer-list">
            {dbLayers.map((a) => (
              <li key={a.id}>
                <span>{a.name}</span>
                <button
                  className="add-layer-btn"
                  disabled={activeRefs.has(a.sourceRef)}
                  onClick={() => onAddDb(a)}
                >
                  {activeRefs.has(a.sourceRef) ? "ADDED" : "+ ADD"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

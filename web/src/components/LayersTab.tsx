import { useState } from "react";
import {
  GEE_AVAILABLE, mapStore, useMapStore,
  type AvailableLayer, type ActiveLayer,
} from "../store/mapStore";
import LayerPropertiesPanel from "./LayerPropertiesPanel";

interface Props {
  onAddDb: (a: AvailableLayer) => void;
}

const KIND_LABEL: Record<string, string> = {
  blocks:    "BLOCK",
  reference: "REF",
  gee:       "GEE",
  db:        "DB",
};

// Tab "Layers": manajemen layer aktif dengan role badge, simbologi, dan proteksi block layer.
// Block layer = singleton (tidak bisa dihapus, selalu ada di posisi terbawah stack).
// Reference layers = multi, bisa reorder, hapus, dan edit konfigurasi diagnostik.
export default function LayersTab({ onAddDb }: Props) {
  const activeLayers = useMapStore((s) => s.activeLayers);
  const dbLayers     = useMapStore((s) => s.dbLayers);
  const tableLayer   = useMapStore((s) => s.tableLayer);
  const [editingId, setEditingId] = useState<string | null>(null);

  const activeRefs = new Set(activeLayers.map((l) => l.sourceRef));

  const toggleEdit = (id: string) => {
    setEditingId((cur) => {
      const next = cur === id ? null : id;
      if (next) mapStore.selectLayer(id);
      return next;
    });
  };

  const refLayers    = activeLayers.filter((l) => l.kind === "reference");
  const analysisAvailable = refLayers.length > 0;

  return (
    <div className="layers-tab">
      {/* ── ACTIVE LAYERS ─────────────────────────────────────── */}
      <div className="sidebar-section">
        <div className="layer-list-header">
          <h3 className="sidebar-title">Layer Aktif</h3>
          <span className="layer-count">{activeLayers.length}</span>
        </div>

        {/* Analysis readiness indicator */}
        {analysisAvailable ? (
          <div className="analysis-ready-hint">
            {refLayers.length} reference layer siap. Klik <b>Run Analysis</b> di toolbar atas.
          </div>
        ) : (
          <div className="analysis-not-ready-hint">
            Tambah Reference Layer untuk mengaktifkan analisis intersect.
          </div>
        )}

        <ul className="active-layer-list">
          {activeLayers.map((l, idx) => (
            <LayerItem
              key={l.id}
              layer={l}
              idx={idx}
              total={activeLayers.length}
              isEditing={editingId === l.id}
              onToggleEdit={toggleEdit}
            />
          ))}
        </ul>

        {/* Table Layer badge */}
        {tableLayer && (
          <div className="table-layer-badge">
            <span className="lp-kind-badge lk-table">TABLE</span>
            <span className="table-layer-name">{tableLayer.name}</span>
            <span className="table-layer-meta">
              {tableLayer.rows.length} baris · join: {tableLayer.joinField}
            </span>
            <button className="layer-remove-btn"
              onClick={() => mapStore.setTableLayer(null)} title="Hapus table layer">
              x
            </button>
          </div>
        )}
      </div>

      {/* ── AVAILABLE LAYERS ──────────────────────────────────── */}
      <div className="sidebar-section" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <h3 className="sidebar-title">Available Layers</h3>

        {/* GEE Sources */}
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

        {/* Reference + DB Sources */}
        <div className="avail-group-title">Database Sources</div>
        {dbLayers.length === 0 ? (
          <div className="avail-empty">
            Belum ada layer. Buka tab <b>Upload</b> untuk menambah SHP/GeoJSON.
          </div>
        ) : (
          <ul className="layer-list">
            {dbLayers.map((a) => (
              <li key={a.id}>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
                  <span>{a.name}</span>
                  {(a.layerRole === "reference" || a.periodLabel) && (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                      {a.layerRole === "reference" ? "REF" : "DB"}
                      {a.periodLabel ? ` · ${a.periodLabel}` : ""}
                      {a.diagnosticField ? ` · ${a.diagnosticField}` : ""}
                    </span>
                  )}
                </div>
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

// ── Layer List Item ────────────────────────────────────────────────────────────
function LayerItem({
  layer, idx, total, isEditing, onToggleEdit,
}: {
  layer: ActiveLayer;
  idx: number;
  total: number;
  isEditing: boolean;
  onToggleEdit: (id: string) => void;
}) {
  const isBlock = layer.kind === "blocks";

  return (
    <li className="active-layer-item">
      <div className={`active-layer${isEditing ? " selected" : ""}`}>
        {/* Visibility checkbox */}
        <input
          type="checkbox"
          checked={layer.visible}
          onChange={() => mapStore.toggleLayerVisible(layer.id)}
          title="Toggle visibility"
        />

        {/* Color dot */}
        <span className={`layer-kind-dot lk-${layer.kind}`} />

        {/* Name + kind badge */}
        <div className="active-layer-info">
          <span className="active-layer-name">{layer.name}</span>
          <span className={`lp-kind-badge lk-${layer.kind}`}>
            {KIND_LABEL[layer.kind] ?? layer.kind}
          </span>
          {layer.referenceConfig?.periodLabel && (
            <span className="layer-period-tag">{layer.referenceConfig.periodLabel}</span>
          )}
        </div>

        {/* Actions */}
        <span className="layer-actions">
          <button
            className={`layer-edit${isEditing ? " on" : ""}`}
            onClick={() => onToggleEdit(layer.id)}
            title="Edit properti layer"
          >
            ✎
          </button>
          {!isBlock && (
            <>
              <button
                disabled={idx <= 1}
                onClick={() => mapStore.reorderLayer(layer.id, -1)}
                title="Naikkan urutan"
              >
                up
              </button>
              <button
                disabled={idx >= total - 1}
                onClick={() => mapStore.reorderLayer(layer.id, 1)}
                title="Turunkan urutan"
              >
                dn
              </button>
              <button
                className="layer-remove-btn"
                onClick={() => {
                  mapStore.removeLayer(layer.id);
                }}
                title="Hapus layer"
              >
                x
              </button>
            </>
          )}
          {isBlock && (
            <span className="layer-protected" title="Block layer tidak bisa dihapus">lock</span>
          )}
        </span>
      </div>

      {/* Inline layer properties panel */}
      {isEditing && (
        <div className="layer-sym-editor">
          <LayerPropertiesPanel />
        </div>
      )}
    </li>
  );
}

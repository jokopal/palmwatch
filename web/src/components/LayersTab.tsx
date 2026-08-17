import { useState } from "react";
import {
  GEE_AVAILABLE, mapStore, useMapStore,
  type AvailableLayer, type ActiveLayer,
} from "../store/mapStore";
import LayerPropertiesPanel from "./LayerPropertiesPanel";
import { useCapabilities } from "../auth";
import { isHidden, isReady } from "../features";
import { canZoomToLayer, zoomToLayer } from "../map/zoomToLayer";
import { publishLayers } from "../publishedLayers";

interface Props {
  onAddDb: (a: AvailableLayer) => void;
  projectId: string | null;
}

const KIND_LABEL: Record<string, string> = {
  blocks:    "REF/AOI",
  reference: "REF/AOI",
  gee:       "GEE",
  db:        "DB",
  raster:    "COG",
};

// Tab "Layers": manajemen layer aktif dengan role badge, simbologi, dan proteksi block layer.
// Block layer = singleton (tidak bisa dihapus, selalu ada di posisi terbawah stack).
// Reference layers = multi, bisa reorder, hapus, dan edit konfigurasi diagnostik.
export default function LayersTab({ onAddDb, projectId }: Props) {
  const activeLayers = useMapStore((s) => s.activeLayers);
  const dbLayers     = useMapStore((s) => s.dbLayers);
  const rasterLayers = useMapStore((s) => s.rasterLayers);
  const tableLayer   = useMapStore((s) => s.tableLayer);
  const caps         = useCapabilities();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);

  const handlePublish = async () => {
    if (!projectId) return;
    setPublishing(true);
    const res = await publishLayers(projectId);
    setPublishing(false);
    setPublishMsg(res.ok
      ? `${res.nLayers} layer dipublikasikan. Anggota project akan melihat susunan ini.`
      : `Gagal memublikasikan: ${res.error ?? "tidak diketahui"}`);
    setTimeout(() => setPublishMsg(null), 5000);
  };

  const activeRefs = new Set(activeLayers.map((l) => l.sourceRef));
  const hasBlocks = activeLayers.some((l) => l.kind === "blocks");

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

        {/* Analysis readiness indicator (admin only) */}
        {caps.runAnalysis && isReady("analysis") && (analysisAvailable ? (
          <div className="analysis-ready-hint">
            {refLayers.length} reference layer siap. Klik <b>Run Analysis</b> di toolbar atas.
          </div>
        ) : (
          <div className="analysis-not-ready-hint">
            Tambah Reference Layer untuk mengaktifkan analisis intersect.
          </div>
        ))}

        {/* Publikasi: susunan layer aktif admin menjadi titik awal bagi anggota
            project. Tanpa ini, anggota tidak punya layer apa pun selain blok. */}
        {caps.publishLayers && (
          <div className="publish-row">
            <button
              className="publish-btn"
              onClick={handlePublish}
              disabled={publishing || !projectId || activeLayers.length === 0}
              title={
                !projectId ? "Pilih project terlebih dahulu"
                : activeLayers.length === 0 ? "Tidak ada layer aktif untuk dipublikasikan"
                : "Simpan susunan ini sebagai tampilan awal bagi anggota project"
              }
            >
              {publishing ? "Memublikasikan…" : `📢 Publikasikan ${activeLayers.length} layer ke user`}
            </button>
          </div>
        )}
        {publishMsg && (
          <div className={`lp-msg ${publishMsg.startsWith("Gagal") ? "err" : "ok"}`}>{publishMsg}</div>
        )}

        {activeLayers.length > 1 && (
          <div className="layer-stack-hint">
            Urutan daftar = urutan gambar (teratas menutupi yang di bawah).
            Raster selalu digambar di bawah seluruh layer vektor.
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
            {caps.manageLayerSet && (
              <button className="layer-remove-btn"
                onClick={() => mapStore.setTableLayer(null)} title="Hapus table layer">
                x
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── AVAILABLE LAYERS (admin only — user = read-only) ──── */}
      {caps.manageLayerSet && (
      <div className="sidebar-section" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <h3 className="sidebar-title">Available Layers</h3>

        {/* Lapisan Referensi & AOI — gabungan Blok utama (AOI) & Reference layers */}
        <div className="avail-group-title">Lapisan Referensi & AOI</div>
        <ul className="layer-list">
          <li>
            <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
              <span>Harvest Blocks</span>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                AOI · Batas blok kebun & area penelitian
              </span>
            </div>
            <button
              className="add-layer-btn"
              disabled={hasBlocks}
              onClick={() => mapStore.addBlocksLayer()}
            >
              {hasBlocks ? "ACTIVE" : "+ ADD"}
            </button>
          </li>
          {dbLayers.length === 0 ? (
            <li className="avail-empty" style={{ listStyle: "none" }}>
              Belum ada reference layer tambahan. Upload file di tab <b>Upload</b>.
            </li>
          ) : (
            dbLayers.map((a) => (
              <li key={a.id}>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
                  <span>{a.name}</span>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                    {a.layerRole === "reference" ? "REF" : "DB"}
                    {a.periodLabel ? ` · ${a.periodLabel}` : ""}
                    {a.diagnosticField ? ` · ${a.diagnosticField}` : ""}
                  </span>
                </div>
                <button
                  className="add-layer-btn"
                  disabled={activeRefs.has(a.sourceRef)}
                  onClick={() => onAddDb(a)}
                >
                  {activeRefs.has(a.sourceRef) ? "ADDED" : "+ ADD"}
                </button>
              </li>
            ))
          )}
        </ul>

        {/* Raster COG Sources */}
        <div className="avail-group-title">Raster (COG)</div>
        {rasterLayers.length === 0 ? (
          <div className="avail-empty">
            Belum ada raster. Buka tab <b>Upload</b> untuk menambah GeoTIFF (COG).
          </div>
        ) : (
          <ul className="layer-list">
            {rasterLayers.map((a) => (
              <li key={a.id}>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
                  <span>{a.name}</span>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                    COG{a.rasterConfig?.category ? ` · ${a.rasterConfig.category}` : ""}
                  </span>
                </div>
                <button
                  className="add-layer-btn"
                  disabled={activeRefs.has(a.sourceRef)}
                  onClick={() => mapStore.addRasterLayer(a)}
                >
                  {activeRefs.has(a.sourceRef) ? "ADDED" : "+ ADD"}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* GEE Sources — disembunyikan selama belum ada pipeline tile.
            Menampilkannya hanya membuat pengguna menambah layer yang mustahil
            digambar, lalu menyimpulkan aplikasinya rusak. */}
        {!isHidden("geeLayers") && (
          <>
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
          </>
        )}
      </div>
      )}
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
  const isLocked = Boolean(layer.locked);
  const caps = useCapabilities();
  const error = useMapStore((s) => s.layerErrors[layer.id]);

  const notRenderable = layer.kind === "gee";

  return (
    <li className="active-layer-item">
      <div className={`active-layer${isEditing ? " selected" : ""}${isLocked ? " locked" : ""}`}>
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
          {isLocked && (
            <span className="layer-lock-tag" title="Layer terkunci (read-only)">🔒</span>
          )}
          {notRenderable && (
            <span className="layer-warn-tag" title="Layer GEE belum bisa digambar di peta (butuh pipeline tile)">
              tak dirender
            </span>
          )}
          {error && (
            <span className="layer-error-tag" title={error}>gagal</span>
          )}
        </div>

        {/* Aksi tampilan (zoom, simbologi, urutan) terbuka untuk anggota project;
            mengubah SUSUNAN (kunci, hapus) tetap milik admin. */}
        {caps.styleLayers && (
          <span className="layer-actions">
            <button
              className="layer-zoom-btn"
              onClick={() => zoomToLayer(layer)}
              disabled={!canZoomToLayer(layer)}
              title="Zoom ke layer ini"
            >
              ⛶
            </button>
            {caps.manageLayerSet && (
              <button
                className={`layer-lock-btn${isLocked ? " on" : ""}`}
                onClick={() => {
                  if (isEditing && !isLocked) onToggleEdit(layer.id);
                  mapStore.toggleLayerLock(layer.id);
                }}
                title={isLocked ? "Buka kunci layer" : "Kunci layer agar tidak diedit"}
              >
                {isLocked ? "🔒" : "🔓"}
              </button>
            )}
            {!isLocked && (
              <>
                <button
                  className={`layer-edit${isEditing ? " on" : ""}`}
                  onClick={() => onToggleEdit(layer.id)}
                  title="Edit properti layer"
                >
                  ✎
                </button>
                <button disabled={idx <= 0} onClick={() => mapStore.reorderLayer(layer.id, -1)}
                  title="Naikkan ke atas tumpukan">▲</button>
                <button disabled={idx >= total - 1} onClick={() => mapStore.reorderLayer(layer.id, 1)}
                  title="Turunkan di tumpukan">▼</button>
                {/* Menghapus layer hanya untuk admin: anggota tidak punya
                    katalog untuk menambahkannya kembali. */}
                {caps.manageLayerSet && (
                  <button className="layer-remove-btn" onClick={() => mapStore.removeLayer(layer.id)}
                    title={isBlock ? "Lepas layer blok dari peta" : "Hapus layer"}>✕</button>
                )}
              </>
            )}
          </span>
        )}
      </div>

      {/* Inline layer properties panel (admin only, if not locked) */}
      {isEditing && caps.styleLayers && !isLocked && (
        <div className="layer-sym-editor">
          <LayerPropertiesPanel />
        </div>
      )}
    </li>
  );
}

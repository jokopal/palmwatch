import { useEffect, useState } from "react";
import {
  mapStore, useMapStore,
  type Symbology, type LayerClass, type ReferenceLayerConfig,
} from "../store/mapStore";
import { detectClasses, updateRefLayerMeta } from "../analysisApi";

// Panel properti layer terpadu:
//   - Block layer   : symbology (kategorized by priority) + label config
//   - Reference layer: symbology + label + class config + weight + period
//   - GEE/DB layer  : symbology single/categorized + label

export default function LayerPropertiesPanel() {
  const selectedId = useMapStore((s) => s.selectedLayerId);
  const layer = useMapStore((s) => s.activeLayers.find((l) => l.id === s.selectedLayerId) ?? null);

  const [symDraft, setSymDraft]    = useState<Symbology | null>(null);
  const [refDraft, setRefDraft]    = useState<ReferenceLayerConfig | null>(null);
  const [saving, setSaving]        = useState(false);
  const [savedMsg, setSavedMsg]    = useState<string | null>(null);

  // Sync draft saat layer berubah
  useEffect(() => {
    if (!layer) { setSymDraft(null); setRefDraft(null); return; }
    setSymDraft({
      ...layer.symbology,
      categories: layer.symbology.categories.map((c) => ({ ...c })),
    });
    setRefDraft(layer.referenceConfig
      ? { ...layer.referenceConfig, classes: layer.referenceConfig.classes.map((c) => ({ ...c })) }
      : null);
    setSavedMsg(null);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!layer || !symDraft) {
    return (
      <div className="sym-panel empty">
        Pilih layer di daftar <b>Active Layers</b> untuk mengedit propertinya.
      </div>
    );
  }

  const patchSym = (p: Partial<Symbology>) => setSymDraft({ ...symDraft, ...p });
  const setCatColor = (i: number, color: string) =>
    setSymDraft({ ...symDraft, categories: symDraft.categories.map((c, j) => (j === i ? { ...c, color } : c)) });

  const apply = () => {
    mapStore.updateSymbology(layer.id, symDraft);
    if (refDraft) mapStore.updateReferenceConfig(layer.id, refDraft);
  };

  const applyAndSaveToDb = async () => {
    apply();
    if (!refDraft?.dbLayerId) return;
    setSaving(true);
    const ok = await updateRefLayerMeta(refDraft.dbLayerId, {
      diagnosticField: refDraft.diagnosticField,
      layerConfig: { classes: refDraft.classes, weight: refDraft.weight },
      periodLabel: refDraft.periodLabel,
    });
    setSaving(false);
    setSavedMsg(ok ? "Tersimpan ke database." : "Gagal menyimpan ke DB.");
    setTimeout(() => setSavedMsg(null), 3000);
  };

  // Auto-detect classes dari data layer
  const handleDetectClasses = () => {
    if (!refDraft || !layer.data || !refDraft.diagnosticField) return;
    const detected = detectClasses(layer.data, refDraft.diagnosticField);
    setRefDraft({ ...refDraft, classes: detected });
  };

  // Edit kelas referensi
  const patchClass = (i: number, patch: Partial<LayerClass>) =>
    setRefDraft((d) => d ? {
      ...d,
      classes: d.classes.map((c, j) => j === i ? { ...c, ...patch } : c),
    } : d);

  const canCategorize = Boolean(symDraft.categoryField && symDraft.categories.length > 0);
  const isRef = layer.kind === "reference";
  const isBlocks = layer.kind === "blocks";

  return (
    <div className="sym-panel">
      {/* Header */}
      <div className="sym-head">
        <span className="sym-layer-name">{layer.name}</span>
        <span className={`lp-kind-badge lk-${layer.kind}`}>
          {layer.kind === "blocks" ? "BLOCK" : layer.kind === "reference" ? "REF" : layer.kind.toUpperCase()}
        </span>
      </div>

      {/* ── Symbology Section ─────────────────────────────────────── */}
      <div className="lp-section-title">Simbologi</div>

      {canCategorize && !isBlocks && (
        <div className="sym-row">
          <label>Render</label>
          <select
            value={symDraft.mode}
            onChange={(e) => patchSym({ mode: e.target.value as Symbology["mode"] })}
          >
            <option value="single">Single Symbol</option>
            <option value="categorized">Kategorized ({symDraft.categoryField})</option>
          </select>
        </div>
      )}

      {symDraft.mode === "categorized" && canCategorize ? (
        <div className="sym-categories">
          {symDraft.categories.map((c, i) => (
            <div className="sym-cat" key={c.value}>
              <input type="color" value={c.color}
                onChange={(e) => setCatColor(i, e.target.value)} />
              <span className="sym-cat-label">{c.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="sym-row">
          <label>Fill</label>
          <input type="color" value={symDraft.fill}
            onChange={(e) => patchSym({ fill: e.target.value })} />
        </div>
      )}

      <div className="sym-row">
        <label>Opacity</label>
        <input type="range" min={0} max={1} step={0.05} value={symDraft.fillOpacity}
          onChange={(e) => patchSym({ fillOpacity: Number(e.target.value) })} />
        <span className="sym-val">{Math.round(symDraft.fillOpacity * 100)}%</span>
      </div>

      <div className="sym-row">
        <label>Stroke</label>
        <input type="color" value={symDraft.stroke}
          onChange={(e) => patchSym({ stroke: e.target.value })} />
        <input type="range" min={0} max={6} step={0.5} value={symDraft.strokeWidth}
          onChange={(e) => patchSym({ strokeWidth: Number(e.target.value) })} />
        <span className="sym-val">{symDraft.strokeWidth}px</span>
      </div>

      {/* ── Label Section ─────────────────────────────────────────── */}
      <div className="lp-section-title">Label</div>

      <div className="sym-row">
        <label>Tampilkan</label>
        <input type="checkbox" checked={symDraft.labelVisible ?? false}
          onChange={(e) => patchSym({ labelVisible: e.target.checked })} />
      </div>

      {symDraft.labelVisible && (
        <>
          <div className="sym-row">
            <label>Field</label>
            <input
              type="text"
              className="lp-text-input"
              value={symDraft.labelField ?? ""}
              placeholder="mis. block_id"
              onChange={(e) => patchSym({ labelField: e.target.value })}
            />
          </div>
          <div className="sym-row">
            <label>Ukuran</label>
            <input type="range" min={8} max={18} step={1} value={symDraft.labelFontSize ?? 10}
              onChange={(e) => patchSym({ labelFontSize: Number(e.target.value) })} />
            <span className="sym-val">{symDraft.labelFontSize ?? 10}px</span>
          </div>
          <div className="sym-row">
            <label>Warna</label>
            <input type="color" value={symDraft.labelColor ?? "#ffffff"}
              onChange={(e) => patchSym({ labelColor: e.target.value })} />
          </div>
        </>
      )}

      {/* ── Reference Layer Config ────────────────────────────────── */}
      {isRef && refDraft && (
        <>
          <div className="lp-section-title">Konfigurasi Diagnostik</div>

          <div className="sym-row">
            <label>Field</label>
            <input
              type="text"
              className="lp-text-input"
              value={refDraft.diagnosticField}
              placeholder="mis. kelas_ndvi"
              onChange={(e) => setRefDraft({ ...refDraft, diagnosticField: e.target.value })}
            />
          </div>

          <div className="sym-row">
            <label>Bobot</label>
            <input type="range" min={0} max={1} step={0.1} value={refDraft.weight}
              onChange={(e) => setRefDraft({ ...refDraft, weight: Number(e.target.value) })} />
            <span className="sym-val">{refDraft.weight.toFixed(1)}</span>
          </div>

          <div className="sym-row">
            <label>Periode</label>
            <input
              type="text"
              className="lp-text-input"
              value={refDraft.periodLabel ?? ""}
              placeholder="mis. 2024-Q3"
              onChange={(e) => setRefDraft({ ...refDraft, periodLabel: e.target.value })}
            />
          </div>

          <div className="sym-row">
            <label>Grup Temporal</label>
            <input
              type="text"
              className="lp-text-input"
              value={refDraft.layerGroup ?? ""}
              placeholder="mis. ndvi-kebun-a"
              onChange={(e) => setRefDraft({ ...refDraft, layerGroup: e.target.value })}
            />
          </div>

          {/* Kelas diskrit */}
          <div className="lp-class-header">
            <span className="lp-section-title" style={{ marginBottom: 0 }}>Kelas Diskrit ({refDraft.classes.length})</span>
            <button className="lp-detect-btn" onClick={handleDetectClasses}
              disabled={!refDraft.diagnosticField || !layer.data}
              title="Auto-detect kelas dari data layer">
              Auto-detect
            </button>
          </div>

          {refDraft.classes.length === 0 ? (
            <div className="lp-class-empty">
              Isi field diagnostik lalu klik Auto-detect, atau tambah kelas manual.
            </div>
          ) : (
            <div className="lp-class-list">
              <div className="lp-class-row lp-class-header-row">
                <span>Warna</span><span>Nilai</span><span>Label</span><span>Kritis?</span>
              </div>
              {refDraft.classes.map((c, i) => (
                <div className="lp-class-row" key={i}>
                  <input type="color" value={c.color}
                    onChange={(e) => patchClass(i, { color: e.target.value })} />
                  <span className="lp-class-value">{c.value}</span>
                  <input type="text" className="lp-text-input sm"
                    value={c.label}
                    onChange={(e) => patchClass(i, { label: e.target.value })} />
                  <input type="checkbox" checked={c.isProblematic}
                    onChange={(e) => patchClass(i, { isProblematic: e.target.checked })} />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Actions ───────────────────────────────────────────────── */}
      {savedMsg && (
        <div className={`lp-msg ${savedMsg.includes("Gagal") ? "err" : "ok"}`}>
          {savedMsg}
        </div>
      )}

      <div className="lp-actions">
        <button className="sym-apply" onClick={apply} style={{ flex: 1 }}>
          Apply
        </button>
        {isRef && refDraft?.dbLayerId && (
          <button className="sym-apply" onClick={applyAndSaveToDb}
            disabled={saving} style={{ flex: 1, background: "var(--color-teal-mid)" }}>
            {saving ? "Menyimpan..." : "Apply + Simpan DB"}
          </button>
        )}
      </div>
    </div>
  );
}

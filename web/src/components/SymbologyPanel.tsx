import { useEffect, useState } from "react";
import { mapStore, useMapStore, type Symbology } from "../store/mapStore";

// Panel properti simbologi untuk layer terpilih (mirip QGIS): single/categorized
// dengan stroke, fill, color, size (width), opacity. Apply -> update peta + legenda.
export default function SymbologyPanel() {
  const selectedId = useMapStore((s) => s.selectedLayerId);
  const layer = useMapStore((s) => s.activeLayers.find((l) => l.id === s.selectedLayerId) ?? null);

  const [draft, setDraft] = useState<Symbology | null>(layer?.symbology ?? null);

  // Reset draft saat layer terpilih berubah.
  useEffect(() => {
    setDraft(layer ? { ...layer.symbology, categories: layer.symbology.categories.map((c) => ({ ...c })) } : null);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!layer || !draft) {
    return (
      <div className="sym-panel empty">
        Pilih layer di daftar <b>Active Layers</b> untuk mengedit simbologinya.
      </div>
    );
  }

  const canCategorize = Boolean(draft.categoryField && draft.categories.length > 0);
  const patch = (p: Partial<Symbology>) => setDraft({ ...draft, ...p });
  const setCatColor = (i: number, color: string) =>
    setDraft({ ...draft, categories: draft.categories.map((c, j) => (j === i ? { ...c, color } : c)) });

  const apply = () => mapStore.updateSymbology(layer.id, draft);

  return (
    <div className="sym-panel">
      <div className="sym-head">
        <span className="sym-layer-name">{layer.name}</span>
        <span className="sym-kind">{layer.kind}</span>
      </div>

      {canCategorize && (
        <div className="sym-row">
          <label>Render</label>
          <select
            value={draft.mode}
            onChange={(e) => patch({ mode: e.target.value as Symbology["mode"] })}
          >
            <option value="single">Single symbol</option>
            <option value="categorized">Categorized ({draft.categoryField})</option>
          </select>
        </div>
      )}

      {draft.mode === "categorized" && canCategorize ? (
        <div className="sym-categories">
          {draft.categories.map((c, i) => (
            <div className="sym-cat" key={c.value}>
              <input type="color" value={c.color} onChange={(e) => setCatColor(i, e.target.value)} />
              <span>{c.label}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="sym-row">
          <label>Fill</label>
          <input type="color" value={draft.fill} onChange={(e) => patch({ fill: e.target.value })} />
        </div>
      )}

      <div className="sym-row">
        <label>Fill opacity</label>
        <input
          type="range" min={0} max={1} step={0.05} value={draft.fillOpacity}
          onChange={(e) => patch({ fillOpacity: Number(e.target.value) })}
        />
        <span className="sym-val">{Math.round(draft.fillOpacity * 100)}%</span>
      </div>

      <div className="sym-row">
        <label>Stroke</label>
        <input type="color" value={draft.stroke} onChange={(e) => patch({ stroke: e.target.value })} />
      </div>

      <div className="sym-row">
        <label>Stroke width</label>
        <input
          type="range" min={0} max={6} step={0.5} value={draft.strokeWidth}
          onChange={(e) => patch({ strokeWidth: Number(e.target.value) })}
        />
        <span className="sym-val">{draft.strokeWidth}px</span>
      </div>

      <button className="sym-apply" onClick={apply}>Apply Symbology</button>
    </div>
  );
}

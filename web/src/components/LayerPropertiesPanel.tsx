import { useMemo, useState } from "react";
import {
  mapStore, useMapStore,
  type ActiveLayer, type Symbology, type LayerClass,
} from "../store/mapStore";
import { detectClasses, updateRefLayerMeta } from "../analysisApi";

// Panel properti layer terpadu.
//
// PERUBAHAN BERSIFAT LANGSUNG (live): setiap ubahan warna/opacity/label/kelas
// ditulis ke store saat itu juga sehingga peta ikut berubah seketika.
// Sebelumnya panel ini memakai draft lokal + tombol "Apply"; kombinasinya dengan
// bug categoryField membuat menekan Apply seolah tidak melakukan apa-apa.
// Tombol yang tersisa hanya "Simpan ke DB" — satu-satunya aksi yang memang
// perlu konfirmasi karena menulis ke database.

// Properti blok yang tersedia sebagai kandidat label/kategori. Layer blok tidak
// menyimpan GeoJSON-nya di store (datanya milik App), jadi daftarnya statis.
const BLOCK_FIELDS = [
  "block_id", "estate", "area_ha", "planting_year", "age_years", "variety",
  "priority_level", "severity_score", "n_conditions", "n_interventions",
  "ndvi_value", "rainfall_30d_mm", "temp_2m_mean", "soil_ph", "soil_soc",
];

/** Nama field yang benar-benar ada pada data layer (untuk dropdown). */
function fieldsOf(layer: ActiveLayer): string[] {
  if (layer.kind === "blocks") return BLOCK_FIELDS;
  const feats = layer.data?.features ?? [];
  const keys = new Set<string>();
  for (const f of feats.slice(0, 20)) {
    for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  }
  return [...keys].sort();
}

export default function LayerPropertiesPanel() {
  const layer = useMapStore((s) => s.activeLayers.find((l) => l.id === s.selectedLayerId) ?? null);
  const layerError = useMapStore((s) => (s.selectedLayerId ? s.layerErrors[s.selectedLayerId] : undefined));

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const fields = useMemo(() => (layer ? fieldsOf(layer) : []), [layer]);

  if (!layer) {
    return (
      <div className="sym-panel empty">
        Pilih layer di daftar <b>Layer Aktif</b> untuk mengedit propertinya.
      </div>
    );
  }

  if (layer.locked) {
    return (
      <div className="sym-panel empty" style={{ color: "var(--text-muted)", display: "flex", gap: "6px", alignItems: "center" }}>
        <span>🔒</span>
        <span>Layer <b>{layer.name}</b> sedang terkunci. Buka kunci untuk mengedit properti.</span>
      </div>
    );
  }

  const sym = layer.symbology;
  const ref = layer.referenceConfig;
  const raster = layer.rasterConfig;
  const isRef = layer.kind === "reference";
  const isRasterLayer = layer.kind === "raster";
  const isGee = layer.kind === "gee";

  const patchSym = (p: Partial<Symbology>) => mapStore.updateSymbology(layer.id, p);
  const setCatColor = (i: number, color: string) =>
    patchSym({ categories: sym.categories.map((c, j) => (j === i ? { ...c, color } : c)) });

  const patchClass = (i: number, patch: Partial<LayerClass>) => {
    if (!ref) return;
    mapStore.updateReferenceConfig(layer.id, {
      classes: ref.classes.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });
  };

  const handleDetectClasses = () => {
    if (!ref || !layer.data || !ref.diagnosticField) return;
    mapStore.updateReferenceConfig(layer.id, {
      classes: detectClasses(layer.data, ref.diagnosticField),
    });
  };

  const saveToDb = async () => {
    if (!ref?.dbLayerId) return;
    setSaving(true);
    const ok = await updateRefLayerMeta(ref.dbLayerId, {
      diagnosticField: ref.diagnosticField,
      layerConfig: { classes: ref.classes, weight: ref.weight },
      periodLabel: ref.periodLabel,
      layerGroup: ref.layerGroup,
    });
    setSaving(false);
    setSavedMsg(ok ? "Tersimpan ke database." : "Gagal menyimpan ke DB.");
    setTimeout(() => setSavedMsg(null), 3000);
  };

  const canCategorize = sym.categories.length > 0;

  return (
    <div className="sym-panel">
      <div className="sym-head">
        <span className="sym-layer-name">{layer.name}</span>
        <span className={`lp-kind-badge lk-${layer.kind}`}>
          {layer.kind === "blocks" ? "BLOCK" : layer.kind === "reference" ? "REF" : layer.kind.toUpperCase()}
        </span>
      </div>

      {layerError && <div className="lp-msg err">{layerError}</div>}

      {isGee && (
        <div className="lp-msg warn">
          Layer GEE belum bisa digambar di peta (butuh pipeline tile). Layer ini
          hanya tampil di daftar & legenda.
        </div>
      )}

      {/* ── RASTER (overlay PNG) ─────────────────────────────────── */}
      {isRasterLayer && raster && (
        <>
          <div className="lp-section-title">Informasi Raster</div>

          <div className="lp-raster-info">
            <div className="lp-raster-info-head">
              <span><b>Kategori:</b> {(raster.category ?? "other").toUpperCase()}</span>
              <span className="lp-kind-badge lk-raster">PNG OVERLAY</span>
            </div>
            {raster.bounds && (
              <div><b>BBox (EPSG:4326):</b> [{raster.bounds.map((n) => n.toFixed(4)).join(", ")}]</div>
            )}
            <div>
              <b>Rentang nilai:</b>{" "}
              {raster.minValue != null ? Number(raster.minValue).toFixed(2) : "—"}
              {" s.d. "}
              {raster.maxValue != null ? Number(raster.maxValue).toFixed(2) : "—"}
            </div>
            {raster.legend?.length ? (
              <div className="lp-raster-ramp">
                <div
                  className="lp-raster-ramp-bar"
                  style={{ background: `linear-gradient(90deg, ${raster.legend.join(", ")})` }}
                />
                <div className="lp-raster-ramp-name">{raster.colormap}</div>
              </div>
            ) : null}
          </div>

          <div className="lp-section-title">Tampilan</div>

          <div className="sym-row">
            <label>Opacity</label>
            <input type="range" min={0} max={1} step={0.05} value={raster.opacity}
              onChange={(e) => mapStore.updateRasterConfig(layer.id, { opacity: Number(e.target.value) })} />
            <span className="sym-val">{Math.round(raster.opacity * 100)}%</span>
          </div>

          <div className="lp-hint">
            Warna raster dipanggang saat build agar dijamin tampil di peta.
            Untuk mengganti skema warna atau rentang nilai, jalankan ulang{" "}
            <span className="bd-code">scripts/build_raster_overlays.py</span>.
          </div>
        </>
      )}

      {/* ── SIMBOLOGI VEKTOR ─────────────────────────────────────── */}
      {!isRasterLayer && (
        <>
          <div className="lp-section-title">Simbologi</div>

          <div className="sym-row">
            <label>Render</label>
            <select
              value={sym.mode}
              onChange={(e) => patchSym({ mode: e.target.value as Symbology["mode"] })}
            >
              <option value="single">Warna tunggal</option>
              <option value="categorized" disabled={!canCategorize}>
                {canCategorize ? `Per kategori (${sym.categoryField ?? "-"})` : "Per kategori (belum ada kelas)"}
              </option>
            </select>
          </div>

          {sym.mode === "categorized" && canCategorize && (
            <div className="sym-row">
              <label>Field kategori</label>
              <select
                value={sym.categoryField ?? ""}
                onChange={(e) => patchSym({ categoryField: e.target.value || undefined })}
              >
                <option value="">— pilih field —</option>
                {fields.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          )}

          {sym.mode === "categorized" && canCategorize ? (
            <div className="sym-categories">
              {sym.categories.map((c, i) => (
                <div className="sym-cat" key={`${c.value}-${i}`}>
                  <input type="color" value={c.color} onChange={(e) => setCatColor(i, e.target.value)} />
                  <span className="sym-cat-label">{c.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="sym-row">
              <label>Fill</label>
              <input type="color" value={sym.fill} onChange={(e) => patchSym({ fill: e.target.value })} />
            </div>
          )}

          <div className="sym-row">
            <label>Opacity</label>
            <input type="range" min={0} max={1} step={0.05} value={sym.fillOpacity}
              onChange={(e) => patchSym({ fillOpacity: Number(e.target.value) })} />
            <span className="sym-val">{Math.round(sym.fillOpacity * 100)}%</span>
          </div>

          <div className="sym-row">
            <label>Stroke</label>
            <input type="color" value={sym.stroke} onChange={(e) => patchSym({ stroke: e.target.value })} />
            <input type="range" min={0} max={6} step={0.5} value={sym.strokeWidth}
              onChange={(e) => patchSym({ strokeWidth: Number(e.target.value) })} />
            <span className="sym-val">{sym.strokeWidth}px</span>
          </div>

          {/* ── Label ──────────────────────────────────────────────── */}
          <div className="lp-section-title">Label</div>

          <div className="sym-row">
            <label>Tampilkan</label>
            <input type="checkbox" checked={sym.labelVisible ?? false}
              onChange={(e) => patchSym({ labelVisible: e.target.checked })} />
          </div>

          {sym.labelVisible && (
            <>
              <div className="sym-row">
                <label>Field</label>
                {/* Dropdown dari field yang benar-benar ada — dulu input bebas
                    sehingga salah ketik = label kosong tanpa petunjuk. */}
                <select
                  value={sym.labelField ?? ""}
                  onChange={(e) => patchSym({ labelField: e.target.value || undefined })}
                >
                  <option value="">— pilih field —</option>
                  {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="sym-row">
                <label>Ukuran</label>
                <input type="range" min={8} max={18} step={1} value={sym.labelFontSize ?? 10}
                  onChange={(e) => patchSym({ labelFontSize: Number(e.target.value) })} />
                <span className="sym-val">{sym.labelFontSize ?? 10}px</span>
              </div>
              <div className="sym-row">
                <label>Warna</label>
                <input type="color" value={sym.labelColor ?? "#ffffff"}
                  onChange={(e) => patchSym({ labelColor: e.target.value })} />
              </div>
            </>
          )}
        </>
      )}

      {/* ── Konfigurasi diagnostik reference layer ───────────────── */}
      {isRef && ref && (
        <>
          <div className="lp-section-title">Konfigurasi Diagnostik</div>

          <div className="sym-row">
            <label>Field</label>
            <select
              value={ref.diagnosticField}
              onChange={(e) => mapStore.updateReferenceConfig(layer.id, { diagnosticField: e.target.value })}
            >
              <option value="">— pilih field —</option>
              {fields.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          <div className="sym-row">
            <label>Bobot</label>
            <input type="range" min={0} max={1} step={0.1} value={ref.weight}
              onChange={(e) => mapStore.updateReferenceConfig(layer.id, { weight: Number(e.target.value) })} />
            <span className="sym-val">{ref.weight.toFixed(1)}</span>
          </div>

          <div className="sym-row">
            <label>Periode</label>
            <input type="text" className="lp-text-input" value={ref.periodLabel ?? ""}
              placeholder="mis. 2024-Q3"
              onChange={(e) => mapStore.updateReferenceConfig(layer.id, { periodLabel: e.target.value })} />
          </div>

          <div className="sym-row">
            <label>Grup Temporal</label>
            <input type="text" className="lp-text-input" value={ref.layerGroup ?? ""}
              placeholder="mis. ndvi-kebun-a"
              onChange={(e) => mapStore.updateReferenceConfig(layer.id, { layerGroup: e.target.value })} />
          </div>

          <div className="lp-class-header">
            <span className="lp-section-title" style={{ marginBottom: 0 }}>
              Kelas Diskrit ({ref.classes.length})
            </span>
            <button className="lp-detect-btn" onClick={handleDetectClasses}
              disabled={!ref.diagnosticField || !layer.data}
              title="Auto-detect kelas dari data layer">
              Auto-detect
            </button>
          </div>

          {ref.classes.length === 0 ? (
            <div className="lp-class-empty">
              Pilih field diagnostik lalu klik Auto-detect. Selama kelas kosong,
              layer digambar dengan satu warna dan tidak bisa dipakai analisis.
            </div>
          ) : (
            <div className="lp-class-list">
              <div className="lp-class-row lp-class-header-row">
                <span>Warna</span><span>Nilai</span><span>Label</span><span>Kritis?</span>
              </div>
              {ref.classes.map((c, i) => (
                <div className="lp-class-row" key={`${c.value}-${i}`}>
                  <input type="color" value={c.color}
                    onChange={(e) => patchClass(i, { color: e.target.value })} />
                  <span className="lp-class-value">{c.value}</span>
                  <input type="text" className="lp-text-input sm" value={c.label}
                    onChange={(e) => patchClass(i, { label: e.target.value })} />
                  <input type="checkbox" checked={c.isProblematic}
                    onChange={(e) => patchClass(i, { isProblematic: e.target.checked })} />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {savedMsg && (
        <div className={`lp-msg ${savedMsg.includes("Gagal") ? "err" : "ok"}`}>{savedMsg}</div>
      )}

      {isRef && ref?.dbLayerId && (
        <div className="lp-actions">
          <button className="sym-apply" onClick={saveToDb} disabled={saving} style={{ flex: 1 }}>
            {saving ? "Menyimpan…" : "Simpan konfigurasi ke DB"}
          </button>
        </div>
      )}
    </div>
  );
}

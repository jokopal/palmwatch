import { useState } from "react";
import shp from "shpjs";
import * as XLSX from "xlsx";
import { insertRefLayer, detectClasses } from "../analysisApi";
import { importProjectBlocks } from "../projects";
import { mapStore } from "../store/mapStore";
import type { LayerClass, TableLayerConfig } from "../store/mapStore";

type FC = GeoJSON.FeatureCollection;
type Mode = "blocks" | "reference" | "table" | "raster";

interface Props {
  onClose?: () => void;
  projectId: string | null;
  onImported?: () => void;
  onRefLayersChanged?: () => void;
  onRastersChanged?: () => void;
}

// Skema warna geomatico untuk raster single-band (butuh min/max).
const RASTER_COLORMAPS = [
  { value: "", label: "RGB / apa adanya" },
  { value: "BrewerYlGn9", label: "Vegetasi (kuning→hijau)" },
  { value: "BrewerYlGnBu9", label: "Drainase/air (kuning→biru)" },
  { value: "BrewerYlOrRd9", label: "Suhu (kuning→merah)" },
  { value: "BrewerSpectral9", label: "Spektral (umum)" },
];
const RASTER_CATEGORIES = ["dem", "soil", "rainfall", "twi", "ndvi", "other"];

// Tab Upload — 3 mode:
//  "blocks"    : ganti layer blok utama project (AOI)
//  "reference" : upload Reference Layer (SHP/GeoJSON) dengan konfigurasi diagnostik
//  "table"     : import Excel/CSV sebagai Table Layer (join ke block_id)
export default function UploadTab({ onClose, projectId, onImported, onRefLayersChanged, onRastersChanged }: Props) {
  const [mode, setMode] = useState<Mode>("reference");
  const [name, setName]   = useState("");
  const [fc, setFc]       = useState<FC | null>(null);
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState<string | null>(null);
  const [err, setErr]     = useState<string | null>(null);

  // Reference layer config
  const [diagField, setDiagField]   = useState("");
  const [classes, setClasses]       = useState<LayerClass[]>([]);
  const [weight, setWeight]         = useState(1.0);
  const [periodLabel, setPeriodLabel] = useState("");
  const [layerGroup, setLayerGroup] = useState("");
  const [detectedFields, setDetectedFields] = useState<string[]>([]);

  // Table layer
  const [tableRows, setTableRows]     = useState<Record<string, unknown>[]>([]);
  const [tableColumns, setTableColumns] = useState<string[]>([]);
  const [joinField, setJoinField]     = useState("block_id");
  const [valueFields, setValueFields] = useState<string[]>([]);

  // Raster (COG)
  const [rasterFile, setRasterFile]       = useState<File | null>(null);
  const [rasterCategory, setRasterCategory] = useState("other");
  const [rasterColormap, setRasterColormap] = useState("");
  const [rasterMin, setRasterMin]         = useState("");
  const [rasterMax, setRasterMax]         = useState("");

  const normalize = (raw: unknown): FC => {
    const g = Array.isArray(raw) ? (raw[0] as FC) : (raw as FC);
    if (!g || g.type !== "FeatureCollection") throw new Error("Bukan FeatureCollection yang valid.");
    return g;
  };

  // ── Parse spatial file ─────────────────────────────────────────────
  const handleSpatialFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null); setMsg("Membaca file...");
    try {
      const parsed = file.name.toLowerCase().endsWith(".zip")
        ? normalize(await shp(await file.arrayBuffer()))
        : normalize(JSON.parse(await file.text()));
      setFc(parsed);
      setName((n) => n || file.name.replace(/\.(zip|geojson|json)$/i, ""));
      setMsg(`Terbaca: ${parsed.features.length} fitur.`);

      // Detect available fields
      const keys = new Set<string>();
      for (const f of parsed.features.slice(0, 5))
        Object.keys(f.properties ?? {}).forEach((k) => keys.add(k));
      setDetectedFields([...keys]);

      // Auto-detect classes jika ada diagField
      if (diagField && parsed.features.length > 0) {
        setClasses(detectClasses(parsed, diagField));
      }
    } catch (e2) {
      setErr(`Gagal parse: ${(e2 as Error).message}`);
      setFc(null); setMsg(null);
    } finally { e.target.value = ""; }
  };

  // ── Parse Excel/CSV ────────────────────────────────────────────────
  const handleTableFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null); setMsg("Membaca tabel...");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
      if (data.length === 0) throw new Error("Sheet kosong atau tidak ada data.");
      const cols = Object.keys(data[0]);
      setTableRows(data);
      setTableColumns(cols);
      setName((n) => n || file.name.replace(/\.(xlsx|xls|csv)$/i, ""));
      setMsg(`Terbaca: ${data.length} baris, ${cols.length} kolom.`);
      // Auto-set join field jika ada block_id
      if (cols.includes("block_id")) setJoinField("block_id");
    } catch (e2) {
      setErr(`Gagal baca tabel: ${(e2 as Error).message}`);
    } finally { e.target.value = ""; }
  };

  // ── Auto detect classes ────────────────────────────────────────────
  const handleDetectClasses = () => {
    if (!fc || !diagField) return;
    setClasses(detectClasses(fc, diagField));
  };

  // ── Submit ─────────────────────────────────────────────────────────
  const submit = async () => {
    setBusy(true); setErr(null);

    try {
      if (mode === "blocks") {
        if (!projectId) { setErr("Pilih project dulu."); return; }
        if (!fc) { setErr("Pilih file terlebih dahulu."); return; }
        setMsg("Mengimpor batas blok...");
        const res = await importProjectBlocks(projectId, fc);
        if (res.ok) {
          setMsg(`Berhasil impor ${res.imported} blok.`);
          setFc(null); setName("");
          onImported?.();
        } else setErr(res.error ?? "Import gagal.");

      } else if (mode === "reference") {
        if (!name.trim()) { setErr("Isi nama layer."); return; }
        if (!fc) { setErr("Pilih file terlebih dahulu."); return; }
        setMsg("Menyimpan reference layer...");
        const res = await insertRefLayer({
          name: name.trim(),
          geojson: fc,
          diagnosticField: diagField || undefined,
          layerConfig: classes.length > 0
            ? { classes, weight }
            : undefined,
          periodLabel: periodLabel || undefined,
          layerGroup: layerGroup || undefined,
          projectId: projectId ?? undefined,
        });
        if (res.ok) {
          setMsg(`Reference layer "${name.trim()}" tersimpan.`);
          setFc(null); setName(""); setDiagField(""); setClasses([]);
          setPeriodLabel(""); setLayerGroup("");
          onRefLayersChanged?.();
        } else setErr(res.error ?? "Upload gagal.");

      } else if (mode === "raster") {
        if (!name.trim()) { setErr("Isi nama raster."); return; }
        if (!rasterFile) { setErr("Pilih file GeoTIFF (COG) terlebih dahulu."); return; }
        setMsg("Mengunggah & memvalidasi COG…");
        const { uploadRasterCog } = await import("../rasterLayers");
        const res = await uploadRasterCog({
          projectId,
          file: rasterFile,
          name: name.trim(),
          category: rasterCategory,
          colormap: rasterColormap || undefined,
          minValue: rasterMin !== "" ? Number(rasterMin) : undefined,
          maxValue: rasterMax !== "" ? Number(rasterMax) : undefined,
        });
        if (res.ok) {
          setMsg(`Raster "${name.trim()}" terunggah & tercatat.`);
          setRasterFile(null); setName(""); setRasterColormap(""); setRasterMin(""); setRasterMax("");
          onRastersChanged?.();
        } else setErr(res.error ?? "Upload raster gagal.");

      } else {
        // Table layer
        if (!name.trim()) { setErr("Isi nama dataset."); return; }
        if (tableRows.length === 0) { setErr("Pilih file Excel/CSV terlebih dahulu."); return; }
        if (!joinField) { setErr("Pilih field join."); return; }
        const vFields = valueFields.length > 0 ? valueFields : tableColumns.filter((c) => c !== joinField);
        const config: TableLayerConfig = {
          name: name.trim(),
          joinField,
          valueFields: vFields,
          rows: tableRows as TableLayerConfig["rows"],
        };

        if (projectId) {
          setMsg("Menyimpan ke database...");
          const { saveProductionData } = await import("../analysisApi");
          const res = await saveProductionData(projectId, config);
          if (res.ok) {
            mapStore.setTableLayer({ ...config, id: res.id });
            setMsg(`Table layer "${name.trim()}" tersimpan (${tableRows.length} baris).`);
            setTableRows([]); setTableColumns([]); setName("");
          } else setErr(res.error ?? "Gagal simpan.");
        } else {
          // Simpan hanya di session jika belum ada project
          mapStore.setTableLayer(config);
          setMsg(`Table layer "${name.trim()}" dimuat ke sesi (${tableRows.length} baris). Pilih project untuk menyimpan permanen.`);
          setTableRows([]); setTableColumns([]); setName("");
        }
      }
    } finally { setBusy(false); }
  };

  const modeLabels: Record<Mode, string> = {
    blocks:    "Blok Utama (AOI)",
    reference: "Reference Layer",
    table:     "Table Layer (Excel/CSV)",
    raster:    "Raster (COG GeoTIFF)",
  };

  return (
    <div className="upload-tab">
      <div className="upload-head">
        <h3 className="sidebar-title">Import Data</h3>
        {onClose && <button className="upload-close" onClick={onClose} title="Kembali">x</button>}
      </div>

      {/* Mode selector */}
      <div className="upload-mode">
        {(["reference", "blocks", "table", "raster"] as Mode[]).map((m) => (
          <label key={m} className={mode === m ? "on" : ""}>
            <input type="radio" checked={mode === m} onChange={() => { setMode(m); setMsg(null); setErr(null); }} />
            {modeLabels[m]}
          </label>
        ))}
      </div>

      {/* Hint */}
      <p className="upload-hint">
        {mode === "blocks" && "Ganti batas blok produksi project. Setiap poligon jadi 1 blok AOI."}
        {mode === "reference" && "Upload layer vektor (SHP/GeoJSON) sebagai layer referensi untuk analisis overlay."}
        {mode === "table" && "Upload Excel/CSV berisi data produksi lapangan. Di-join ke blok via block_id."}
        {mode === "raster" && "Upload Cloud-Optimized GeoTIFF (DEM, tanah, TWI, dll.). Konversi dulu di luar browser: gdal_translate -of COG in.tif out.tif. Ditampilkan via range-request & bisa di-clip ke boundary."}
      </p>

      {/* ── Spatial file input ─────────────────────────────────── */}
      {(mode === "blocks" || mode === "reference") && (
        <label className="upload-drop">
          <input type="file" accept=".zip,.geojson,.json" onChange={handleSpatialFile} disabled={busy} />
          <span>Pilih file (.zip Shapefile / .geojson)</span>
        </label>
      )}

      {/* ── Raster (COG) file input + config ───────────────────── */}
      {mode === "raster" && (
        <>
          <label className="upload-drop">
            <input type="file" accept=".tif,.tiff" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0] ?? null; setRasterFile(f); if (f) setName((n) => n || f.name.replace(/\.(tif|tiff)$/i, "")); e.target.value = ""; }} />
            <span>{rasterFile ? `Terpilih: ${rasterFile.name}` : "Pilih file COG (.tif / .tiff)"}</span>
          </label>
          {rasterFile && (
            <>
              <div className="control-group">
                <label className="control-label">Nama</label>
                <input className="control-select" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. DEM Elevasi" />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div className="control-group" style={{ flex: 1 }}>
                  <label className="control-label">Kategori</label>
                  <select className="control-select" value={rasterCategory} onChange={(e) => setRasterCategory(e.target.value)}>
                    {RASTER_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="control-group" style={{ flex: 1 }}>
                  <label className="control-label">Skema Warna</label>
                  <select className="control-select" value={rasterColormap} onChange={(e) => setRasterColormap(e.target.value)}>
                    {RASTER_COLORMAPS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              {rasterColormap && (
                <div style={{ display: "flex", gap: 8 }}>
                  <div className="control-group" style={{ flex: 1 }}>
                    <label className="control-label">Nilai Min</label>
                    <input className="control-select" type="number" value={rasterMin} onChange={(e) => setRasterMin(e.target.value)} placeholder="mis. 0" />
                  </div>
                  <div className="control-group" style={{ flex: 1 }}>
                    <label className="control-label">Nilai Max</label>
                    <input className="control-select" type="number" value={rasterMax} onChange={(e) => setRasterMax(e.target.value)} placeholder="mis. 150" />
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Table file input ───────────────────────────────────── */}
      {mode === "table" && (
        <label className="upload-drop">
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleTableFile} disabled={busy} />
          <span>Pilih file (.xlsx / .xls / .csv)</span>
        </label>
      )}

      {/* ── Name field ────────────────────────────────────────── */}
      {(fc || tableRows.length > 0) && (
        <div className="control-group">
          <label className="control-label">Nama</label>
          <input className="control-select" value={name} onChange={(e) => setName(e.target.value)}
            placeholder={mode === "table" ? "mis. FFB 2024" : "mis. NDVI Kelas Mar-2024"} />
        </div>
      )}

      {/* ── Reference layer extra config ─────────────────────── */}
      {mode === "reference" && fc && (
        <div className="upload-ref-config">
          {/* Diagnostic field */}
          <div className="control-group">
            <label className="control-label">Field Diagnostik</label>
            <select className="control-select" value={diagField}
              onChange={(e) => { setDiagField(e.target.value); setClasses([]); }}>
              <option value="">-- pilih field --</option>
              {detectedFields.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {diagField && (
            <div className="control-group">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label className="control-label" style={{ margin: 0 }}>
                  Kelas ({classes.length})
                </label>
                <button className="lp-detect-btn" onClick={handleDetectClasses}>
                  Auto-detect
                </button>
              </div>
              {classes.length > 0 && (
                <div className="lp-class-list" style={{ marginTop: 6 }}>
                  {classes.map((c, i) => (
                    <div className="lp-class-row" key={i}>
                      <input type="color" value={c.color}
                        onChange={(e) => setClasses(classes.map((x, j) => j === i ? { ...x, color: e.target.value } : x))} />
                      <span className="lp-class-value">{c.value}</span>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
                        <input type="checkbox" checked={c.isProblematic}
                          onChange={(e) => setClasses(classes.map((x, j) => j === i ? { ...x, isProblematic: e.target.checked } : x))} />
                        Kritis
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bobot */}
          <div className="control-group">
            <label className="control-label">Bobot Analisis ({weight.toFixed(1)})</label>
            <input type="range" min={0} max={1} step={0.1} value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              style={{ width: "100%", accentColor: "var(--color-cyan)" }} />
          </div>

          {/* Temporal */}
          <div style={{ display: "flex", gap: 8 }}>
            <div className="control-group" style={{ flex: 1 }}>
              <label className="control-label">Label Periode</label>
              <input className="control-select" value={periodLabel}
                onChange={(e) => setPeriodLabel(e.target.value)} placeholder="mis. 2024-Q3" />
            </div>
            <div className="control-group" style={{ flex: 1 }}>
              <label className="control-label">Grup Temporal</label>
              <input className="control-select" value={layerGroup}
                onChange={(e) => setLayerGroup(e.target.value)} placeholder="mis. ndvi-kebun-a" />
            </div>
          </div>
        </div>
      )}

      {/* ── Table layer extra config ──────────────────────────── */}
      {mode === "table" && tableColumns.length > 0 && (
        <div className="upload-ref-config">
          <div className="control-group">
            <label className="control-label">Field Join (= block_id)</label>
            <select className="control-select" value={joinField}
              onChange={(e) => setJoinField(e.target.value)}>
              {tableColumns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="control-group">
            <label className="control-label">Kolom Nilai (kosong = semua)</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {tableColumns.filter((c) => c !== joinField).map((c) => (
                <label key={c} style={{ fontSize: "var(--text-xs)", display: "flex", gap: 3, alignItems: "center" }}>
                  <input type="checkbox"
                    checked={valueFields.includes(c)}
                    onChange={(e) => {
                      if (e.target.checked) setValueFields([...valueFields, c]);
                      else setValueFields(valueFields.filter((v) => v !== c));
                    }} />
                  {c}
                </label>
              ))}
            </div>
          </div>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            Preview: {tableRows.slice(0, 2).map((r, i) => (
              <div key={i} style={{ fontFamily: "var(--font-data)" }}>
                {JSON.stringify(r).slice(0, 80)}
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="upload-submit"
        onClick={submit}
        disabled={busy
          || ((mode === "blocks" || mode === "reference") && !fc)
          || (mode === "table" && tableRows.length === 0)
          || (mode === "raster" && !rasterFile)}>
        {busy ? "Memproses..." :
          mode === "blocks" ? "Import sebagai Blok AOI" :
          mode === "reference" ? "Simpan Reference Layer" :
          mode === "raster" ? "Unggah Raster COG" :
          "Import Table Layer"}
      </button>

      {msg && <div className="upload-msg ok">{msg}</div>}
      {err && <div className="upload-msg err">{err}</div>}
    </div>
  );
}

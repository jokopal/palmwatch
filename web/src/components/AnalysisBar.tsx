import { useState } from "react";
import { mapStore, useMapStore } from "../store/mapStore";
import { runLayerAnalysis, saveAnalysisResult } from "../analysisApi";
import { getVectorLayerGeojson } from "../vectorLayers";

interface Props {
  projectId: string | null;
}

// Toolbar "Run Analysis" yang berada di antara header app dan peta.
// Menampilkan status konfigurasi layer, trigger analisis server-side (PostGIS),
// dan simpan hasil ke DB.
export default function AnalysisBar({ projectId }: Props) {
  const activeLayers  = useMapStore((s) => s.activeLayers);
  const tableLayer    = useMapStore((s) => s.tableLayer);
  const analysisResult = useMapStore((s) => s.analysisResult);
  const running       = useMapStore((s) => s.analysisRunning);

  const [err, setErr]       = useState<string | null>(null);
  const [savingName, setSavingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const blockLayer = activeLayers.find((l) => l.kind === "blocks");
  const refLayers  = activeLayers.filter((l) => l.kind === "reference");

  // Validasi kesiapan analisis
  const issues: string[] = [];
  if (!blockLayer) issues.push("Tidak ada block layer");
  if (refLayers.length === 0) issues.push("Tidak ada reference layer");
  const refWithoutConfig = refLayers.filter(
    (l) => !l.referenceConfig?.diagnosticField || l.referenceConfig.classes.length === 0,
  );
  if (refWithoutConfig.length > 0)
    issues.push(`${refWithoutConfig.length} REF belum dikonfigurasi kelas diagnostik`);

  const canRun = issues.length === 0 && !running;

  const handleRun = async () => {
    setErr(null); setSaveMsg(null);
    if (!canRun || !blockLayer) return;

    mapStore.setAnalysisRunning(true);
    try {
      // Ambil GeoJSON block layer
      const blockGeojson = blockLayer.data ?? (blockLayer.sourceRef
        ? await getVectorLayerGeojson(blockLayer.sourceRef)
        : null);
      if (!blockGeojson) { setErr("Gagal memuat geometri block layer."); return; }

      // Ambil GeoJSON semua ref layers
      const refPayloads = await Promise.all(
        refLayers.map(async (l) => {
          const geojson = l.data ?? (l.sourceRef
            ? await getVectorLayerGeojson(l.sourceRef)
            : null);
          return {
            id: l.referenceConfig?.dbLayerId ?? l.sourceRef ?? l.id,
            name: l.name,
            geojson: geojson!,
            diagnosticField: l.referenceConfig!.diagnosticField,
            classes: l.referenceConfig!.classes,
            weight: l.referenceConfig!.weight,
          };
        }),
      );

      const missing = refPayloads.filter((r) => !r.geojson);
      if (missing.length > 0) {
        setErr(`Gagal memuat GeoJSON: ${missing.map((m) => m.name).join(", ")}`);
        return;
      }

      const res = await runLayerAnalysis({
        blockGeojson: blockGeojson!,
        refLayers: refPayloads,
        projectId: projectId ?? undefined,
      });

      if (!res.ok || !res.result) {
        setErr(res.error ?? "Analisis gagal.");
        return;
      }

      mapStore.setAnalysisResult(res.result);
      // Tambah zona ke peta sebagai layer baru
      mapStore.addAnalysisZoneLayer(res.result);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      mapStore.setAnalysisRunning(false);
    }
  };

  const handleSave = async () => {
    if (!analysisResult || !projectId) return;
    setSaving(true); setSaveMsg(null);
    const name = savingName.trim() || `Analisis ${new Date().toLocaleDateString("id-ID")}`;
    const res = await saveAnalysisResult({
      projectId,
      name,
      blockLayerId: blockLayer?.sourceRef ?? "",
      refLayerIds: refLayers.map((l) => l.referenceConfig?.dbLayerId ?? l.sourceRef ?? ""),
      result: analysisResult,
      tableLayerId: tableLayer?.id,
    });
    setSaving(false);
    if (res.ok) {
      mapStore.setAnalysisResult({ ...analysisResult, saved: true, id: res.resultId, resultLayerId: res.zoneLayerId });
      setSaveMsg("Tersimpan ke database.");
    } else {
      setSaveMsg(`Gagal: ${res.error}`);
    }
  };

  const statusColor = issues.length === 0 ? "var(--normal)" : "var(--warning)";

  return (
    <div className="analysis-bar">
      {/* Kiri: status layer */}
      <div className="ab-status">
        <span className="ab-dot" style={{ background: statusColor }} />
        <span className="ab-block">
          Block: <b>{blockLayer?.name ?? "(none)"}</b>
        </span>
        <span className="ab-sep">|</span>
        <span className="ab-refs">
          Ref: <b>{refLayers.length}</b>
          {refLayers.map((l) => (
            <span key={l.id} className="ab-ref-chip">
              {l.name}
              {l.referenceConfig?.periodLabel ? ` [${l.referenceConfig.periodLabel}]` : ""}
            </span>
          ))}
        </span>
        {tableLayer && (
          <>
            <span className="ab-sep">|</span>
            <span className="ab-table">
              Table: <b>{tableLayer.name}</b>
              <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                {" "}({tableLayer.rows.length} baris)
              </span>
            </span>
          </>
        )}
        {issues.length > 0 && (
          <span className="ab-issues" title={issues.join(" | ")}>
            {issues.length} masalah
          </span>
        )}
      </div>

      {/* Kanan: tombol */}
      <div className="ab-actions">
        {analysisResult && !analysisResult.saved && (
          <div className="ab-save-group">
            <input
              className="ab-save-input"
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              placeholder="Nama hasil analisis..."
            />
            <button className="ab-save-btn" onClick={handleSave} disabled={saving || !projectId}>
              {saving ? "Menyimpan..." : "Simpan ke DB"}
            </button>
          </div>
        )}

        {analysisResult && (
          <button className="ab-clear-btn"
            onClick={() => { mapStore.setAnalysisResult(null); setErr(null); setSaveMsg(null); }}>
            Reset
          </button>
        )}

        <button
          className={`ab-run-btn${canRun ? "" : " disabled"}`}
          onClick={handleRun}
          disabled={!canRun}
          title={issues.length > 0 ? issues.join("; ") : "Jalankan analisis intersect"}
        >
          {running ? (
            <span className="ab-spinner">...</span>
          ) : (
            <>{analysisResult ? "Re-run" : "Run Analysis"}</>
          )}
        </button>
      </div>

      {/* Error / save message */}
      {(err || saveMsg) && (
        <div className={`ab-msg ${err ? "err" : "ok"}`}>
          {err ?? saveMsg}
        </div>
      )}
    </div>
  );
}

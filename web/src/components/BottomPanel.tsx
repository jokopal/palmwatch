import { useEffect, useMemo, useState } from "react";
import type { BlockCollection, Intervention, Timeseries } from "../types";
import { api, PRIORITY_COLOR, PRIORITY_LABEL } from "../api";
import { useMapStore } from "../store/mapStore";
import type { BlockAnalysisSummary, TableRow, AnalysisResult } from "../store/mapStore";
import {
  listTemporalLayers, getTemporalSnapshotGeojson,
  type TemporalSnapshot,
} from "../analysisApi";
import {
  BarChart, Bar, LineChart, Line, CartesianGrid,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// Variabel dataset EO untuk mode Temporal "Dataset" (footer analisis).
const EO_VARS: { key: keyof Timeseries["series"][number]; label: string; unit: string; color: string }[] = [
  { key: "rainfall_30d_mm", label: "Curah Hujan 30 hari", unit: "mm",     color: "#1D6FA4" },
  { key: "rainfall_90d_mm", label: "Curah Hujan 90 hari", unit: "mm",     color: "#0891b2" },
  { key: "temp_2m_mean",    label: "Suhu Udara 2 m",       unit: "°C", color: "#D97706" },
  { key: "lst_celsius",     label: "LST (Suhu Permukaan)", unit: "°C", color: "#C0392B" },
  { key: "ndvi",            label: "NDVI",                 unit: "",       color: "#5FA83F" },
  { key: "evi",             label: "EVI",                  unit: "",       color: "#4D7C0F" },
  { key: "lai",             label: "LAI",                  unit: "",       color: "#166534" },
  { key: "soil_moisture",   label: "Kelembapan Tanah",     unit: "",       color: "#0E7490" },
  { key: "et_stress_ratio", label: "Rasio Stres ET",       unit: "",       color: "#6D28D9" },
  { key: "tbs_ton_ha",      label: "Produksi TBS",         unit: "ton/ha", color: "#8A5A34" },
];

interface Props {
  data: BlockCollection | null;
  selectedId: string | null;
  onSelect?: (id: string) => void;
}

type Tab = "attributes" | "temporal" | "conclusion";

// Panel analisis bawah (3 tab):
// - Attribute Table : fitur dari layer aktif + join Table Layer
// - Temporal        : perkembangan satu reference layer multi-periode
// - Conclusion      : per-layer diagnosis + intervensi (setelah Run Analysis)
export default function BottomPanel({ data, selectedId, onSelect }: Props) {
  const [tab, setTab]         = useState<Tab>("attributes");
  const activeLayers          = useMapStore((s) => s.activeLayers);
  const selectedLayerId       = useMapStore((s) => s.selectedLayerId);
  const tableLayer            = useMapStore((s) => s.tableLayer);
  const analysisResult        = useMapStore((s) => s.analysisResult);

  const activeLayer =
    activeLayers.find((l) => l.id === selectedLayerId) ??
    activeLayers.find((l) => l.kind === "blocks") ??
    activeLayers[0];

  // Fitur dari layer aktif
  const features: Record<string, unknown>[] = useMemo(() => {
    if (!activeLayer) return [];
    if (activeLayer.kind === "blocks")
      return (data?.features ?? []).map((f) => {
        const props = f.properties as unknown as Record<string, unknown>;
        // Join dari Table Layer
        if (tableLayer) {
          const joinKey = tableLayer.joinField;
          const tableRow = tableLayer.rows.find(
            (r) => String(r[joinKey]) === String(props["block_id"]),
          );
          if (tableRow) return { ...props, ...tableRow };
        }
        return props;
      });
    if (activeLayer.data)
      return activeLayer.data.features.map((f) => (f.properties ?? {}) as Record<string, unknown>);
    return [];
  }, [activeLayer, data, tableLayer]);

  const columns = useMemo(() => {
    if (!activeLayer) return [];
    if (activeLayer.kind === "blocks") {
      const base = ["block_id", "estate", "area_ha", "ndvi_value", "priority_level",
        "n_conditions", "n_interventions", "yield_baseline_ton_ha", "regression_r2"];
      if (tableLayer) return [...base, ...tableLayer.valueFields.slice(0, 4)];
      return base;
    }
    const keys = new Set<string>();
    for (const f of features.slice(0, 20)) Object.keys(f).forEach((k) => keys.add(k));
    return [...keys].slice(0, 10);
  }, [activeLayer, features, tableLayer]);

  const selectedFeature = data?.features.find((f) => f.properties.block_id === selectedId);
  const isBlocks = activeLayer?.kind === "blocks";

  // Tab Conclusion hanya aktif jika ada analysisResult
  const hasAnalysis = Boolean(analysisResult);

  return (
    <div className="bottom-panel">
      <div className="bp-tabs">
        <button className={`bp-tab${tab === "attributes" ? " active" : ""}`}
          onClick={() => setTab("attributes")}>
          Attribute Table
        </button>
        <button className={`bp-tab${tab === "temporal" ? " active" : ""}`}
          onClick={() => setTab("temporal")}>
          Temporal
        </button>
        <button
          className={`bp-tab${tab === "conclusion" ? " active" : ""}${!hasAnalysis ? " muted" : ""}`}
          onClick={() => setTab("conclusion")}
          title={!hasAnalysis ? "Jalankan Run Analysis terlebih dahulu" : undefined}>
          Conclusion {hasAnalysis && <span className="bp-tab-dot" />}
        </button>
        <div className="bp-layer-name">
          Layer: <b>{activeLayer?.name ?? "(none)"}</b>
          {" "}&middot; {features.length} fitur
          {tableLayer && isBlocks && (
            <span className="bp-table-join" title={`Table join: ${tableLayer.name}`}>
              {" "}+ TABLE
            </span>
          )}
        </div>
      </div>

      <div className="bp-body">
        {tab === "attributes" && (
          <AttributeTable
            features={features}
            columns={columns}
            idField={isBlocks ? "block_id" : columns[0]}
            selectedId={selectedId}
            onSelect={isBlocks ? onSelect : undefined}
            tableLayer={tableLayer ? { name: tableLayer.name, valueFields: tableLayer.valueFields } : undefined}
          />
        )}
        {tab === "temporal" && <TemporalTab selectedId={selectedId} />}
        {tab === "conclusion" && (
          <ConclusionTab
            analysisResult={analysisResult}
            selectedFeature={selectedFeature?.properties}
            tableLayer={tableLayer}
            selectedBlockId={selectedId}
          />
        )}
      </div>
    </div>
  );
}

// ── Attribute Table ───────────────────────────────────────────────────────────
function AttributeTable({
  features, columns, idField, selectedId, onSelect, tableLayer,
}: {
  features: Record<string, unknown>[];
  columns: string[];
  idField: string;
  selectedId: string | null;
  onSelect?: (id: string) => void;
  tableLayer?: { name: string; valueFields: string[] };
}) {
  if (features.length === 0)
    return (
      <div className="bp-empty">
        Layer aktif tidak punya tabel atribut (mis. layer raster GEE). Pilih layer vektor.
      </div>
    );

  return (
    <div className="attr-table-wrap">
      {tableLayer && (
        <div className="bp-table-join-banner">
          Join aktif: <b>{tableLayer.name}</b> ({tableLayer.valueFields.join(", ")})
        </div>
      )}
      <table className="attr-table">
        <thead>
          <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {features.map((f, i) => {
            const id = String(f[idField] ?? i);
            return (
              <tr
                key={id}
                className={selectedId && id === selectedId ? "sel" : ""}
                onClick={() => onSelect?.(id)}
                style={{ cursor: onSelect ? "pointer" : "default" }}
              >
                {columns.map((c) => <td key={c}>{fmt(f[c])}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v == null) return "-";
  if (Array.isArray(v)) return v.length ? `[${v.length}]` : "-";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 30);
  return String(v);
}

// ── Temporal Tab ──────────────────────────────────────────────────────────────
// Dua mode: "Dataset EO" (tren variabel dari eo_readings per blok) dan
// "Layer Referensi" (perkembangan kelas antar snapshot temporal).
function TemporalTab({ selectedId }: { selectedId: string | null }) {
  const [mode, setMode] = useState<"dataset" | "reference">("dataset");
  return (
    <div className="temporal-tab">
      <div className="temporal-mode-toggle">
        <button className={mode === "dataset" ? "on" : ""} onClick={() => setMode("dataset")}>
          Dataset EO
        </button>
        <button className={mode === "reference" ? "on" : ""} onClick={() => setMode("reference")}>
          Layer Referensi
        </button>
      </div>
      {mode === "dataset" ? <DatasetTemporal selectedId={selectedId} /> : <ReferenceTemporal />}
    </div>
  );
}

// ── Dataset EO temporal: tren satu variabel dari eo_readings untuk blok terpilih.
function DatasetTemporal({ selectedId }: { selectedId: string | null }) {
  const [variable, setVariable] = useState<string>("rainfall_30d_mm");
  const [ts, setTs]           = useState<Timeseries | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedId) { setTs(null); return; }
    setLoading(true);
    api.timeseries(selectedId)
      .then(setTs).catch(() => setTs(null)).finally(() => setLoading(false));
  }, [selectedId]);

  const varDef = EO_VARS.find((v) => v.key === variable) ?? EO_VARS[0];
  const rows = useMemo(() => {
    const series = ts?.series ?? [];
    return series
      .map((p) => ({ date: p.date, value: (p as unknown as Record<string, number | null>)[variable] }))
      .filter((r) => r.value != null);
  }, [ts, variable]);

  if (!selectedId) {
    return (
      <div className="bp-empty" style={{ padding: "24px 16px", textAlign: "center" }}>
        Pilih blok di peta atau tabel untuk melihat tren dataset EO (curah hujan, suhu, NDVI, dll.).
      </div>
    );
  }

  return (
    <>
      <div className="temporal-controls">
        <label className="control-label">Variabel Dataset</label>
        <select className="control-select" value={variable} onChange={(e) => setVariable(e.target.value)}>
          {EO_VARS.map((v) => (
            <option key={v.key} value={v.key}>{v.label}{v.unit ? ` (${v.unit})` : ""}</option>
          ))}
        </select>
        <span className="temporal-meta">
          Blok <b>{selectedId}</b> &middot; {rows.length} titik
          {ts?.series?.some((p) => p.source === "open-meteo") && " · sumber Open-Meteo"}
        </span>
      </div>

      {loading && <div className="bp-empty">Memuat time-series…</div>}
      {!loading && rows.length === 0 && (
        <div className="bp-empty" style={{ padding: "18px 16px", textAlign: "center" }}>
          Belum ada data <b>{varDef.label}</b> untuk blok ini. Jalankan pipeline data
          (mis. <span style={{ fontFamily: "var(--font-data)" }}>run_climate.py</span>) untuk mengisinya.
        </div>
      )}
      {!loading && rows.length > 0 && (
        <div className="temporal-chart">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={rows} margin={{ top: 8, right: 14, bottom: 20, left: -4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} unit={varDef.unit ? ` ${varDef.unit}` : ""} width={48} />
              <Tooltip formatter={(v) => `${v}${varDef.unit ? ` ${varDef.unit}` : ""}`} />
              <Line type="monotone" dataKey="value" name={varDef.label}
                stroke={varDef.color} strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}

// ── Layer Referensi temporal (perkembangan kelas antar snapshot) ────────────────
function ReferenceTemporal() {
  const activeLayers    = useMapStore((s) => s.activeLayers);
  const refLayers       = activeLayers.filter(
    (l) => l.kind === "reference" && l.referenceConfig?.layerGroup,
  );

  const [selectedGroup, setSelectedGroup] = useState<string>(
    refLayers[0]?.referenceConfig?.layerGroup ?? "",
  );
  const [snapshots, setSnapshots]  = useState<TemporalSnapshot[]>([]);
  const [loading, setLoading]      = useState(false);
  const [chartData, setChartData]  = useState<Record<string, unknown>[]>([]);

  // Load snapshot list saat group berubah
  useEffect(() => {
    if (!selectedGroup) { setSnapshots([]); return; }
    setLoading(true);
    listTemporalLayers(selectedGroup)
      .then(setSnapshots)
      .catch(() => setSnapshots([]))
      .finally(() => setLoading(false));
  }, [selectedGroup]);

  // Load GeoJSON semua snapshot dan hitung coverage per kelas
  useEffect(() => {
    if (snapshots.length === 0) { setChartData([]); return; }
    setLoading(true);
    Promise.all(
      snapshots.map(async (s) => {
        const geojson = await getTemporalSnapshotGeojson(s.id);
        if (!geojson || !s.diagnosticField) return { period: s.periodLabel };

        const counts: Record<string, number> = {};
        let total = 0;
        for (const f of geojson.features) {
          const val = String((f.properties as Record<string, unknown>)?.[s.diagnosticField!] ?? "lainnya");
          counts[val] = (counts[val] ?? 0) + 1;
          total++;
        }
        const pcts: Record<string, unknown> = { period: s.periodLabel };
        for (const [k, v] of Object.entries(counts))
          pcts[k] = total > 0 ? Math.round((v / total) * 100) : 0;
        return pcts;
      }),
    )
      .then((rows) => setChartData(rows.filter(Boolean)))
      .finally(() => setLoading(false));
  }, [snapshots]);

  // Kumpulkan semua kelas unik dari snapshot
  const allClasses = useMemo(() => {
    const s = new Set<string>();
    for (const row of chartData)
      for (const k of Object.keys(row))
        if (k !== "period") s.add(k);
    return [...s];
  }, [chartData]);

  const classPalette = [
    "#C0392B", "#D97706", "#5FA83F", "#0891b2",
    "#6D28D9", "#DB2777", "#059669",
  ];

  // Fallback: blok-level temporal (NDVI/TBS dari API) jika tidak ada ref layer temporal
  const hasTemporalRef = refLayers.length > 0 && selectedGroup;

  if (!hasTemporalRef) {
    return <LegacyTemporalTab />;
  }

  return (
    <>
      <div className="temporal-controls">
        <label className="control-label">Layer Group Temporal</label>
        <select className="control-select"
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value)}>
          {refLayers.map((l) => (
            <option key={l.id} value={l.referenceConfig!.layerGroup!}>
              {l.name} (grup: {l.referenceConfig!.layerGroup})
            </option>
          ))}
        </select>
        {snapshots.length > 0 && (
          <span className="temporal-meta">
            {snapshots.length} snapshot ditemukan (
            {snapshots[0]?.periodLabel} - {snapshots[snapshots.length - 1]?.periodLabel})
          </span>
        )}
      </div>

      {loading && <div className="bp-empty">Memuat data temporal...</div>}

      {!loading && chartData.length === 0 && (
        <div className="bp-empty">
          Tidak ada snapshot temporal untuk grup ini. Upload layer referensi dengan label periode
          dan grup yang sama.
        </div>
      )}

      {!loading && chartData.length > 0 && (
        <>
          <div className="temporal-chart">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 20, left: -10 }}>
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis unit="%" tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip formatter={(v) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {allClasses.map((cls, i) => (
                  <Bar key={cls} dataKey={cls} stackId="a"
                    fill={classPalette[i % classPalette.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Tabel delta */}
          {chartData.length >= 2 && (
            <div className="temporal-delta-table">
              <div className="concl-section-title">Delta kelas (pertama vs terakhir)</div>
              <table className="attr-table" style={{ marginTop: 4 }}>
                <thead><tr><th>Kelas</th><th>Awal (%)</th><th>Akhir (%)</th><th>Delta</th></tr></thead>
                <tbody>
                  {allClasses.map((cls) => {
                    const first = Number(chartData[0]?.[cls] ?? 0);
                    const last  = Number(chartData[chartData.length - 1]?.[cls] ?? 0);
                    const delta = last - first;
                    return (
                      <tr key={cls}>
                        <td>{cls}</td>
                        <td style={{ fontFamily: "var(--font-data)" }}>{first}%</td>
                        <td style={{ fontFamily: "var(--font-data)" }}>{last}%</td>
                        <td style={{
                          fontFamily: "var(--font-data)",
                          color: delta > 0 ? "var(--warning)" : delta < 0 ? "var(--normal)" : undefined,
                          fontWeight: 600,
                        }}>
                          {delta > 0 ? "+" : ""}{delta}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

// Temporal fallback
function LegacyTemporalTab() {
  return (
    <div className="bp-empty" style={{ textAlign: "center", padding: "24px 16px" }}>
      <div style={{ fontSize: "var(--text-sm)", marginBottom: 8 }}>
        Tambah Reference Layer dengan <b>Grup Temporal</b> untuk melihat perkembangan kelas antar periode.
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        Upload beberapa snapshot layer yang sama (mis. NDVI kelas) dengan label periode berbeda
        dan grup temporal yang sama di tab Upload.
      </div>
    </div>
  );
}

// ── Conclusion Tab ────────────────────────────────────────────────────────────
function ConclusionTab({
  analysisResult, selectedFeature, tableLayer, selectedBlockId,
}: {
  analysisResult: AnalysisResult | null;
  selectedFeature: BlockCollection["features"][0]["properties"] | undefined;
  tableLayer: { rows: TableRow[]; joinField: string; valueFields: string[]; name: string } | null;
  selectedBlockId: string | null;
}) {
  const result = analysisResult;

  if (!result) {
    return (
      <div className="bp-empty" style={{ textAlign: "center", padding: "24px 16px" }}>
        <div style={{ fontSize: "var(--text-sm)", marginBottom: 8 }}>
          Belum ada hasil analisis.
        </div>
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
          Klik <b>Run Analysis</b> di toolbar atas setelah menambah reference layer dan
          mengkonfigurasi kelas diagnostiknya.
        </div>
      </div>
    );
  }

  // Pilih block summary yang ditampilkan
  const blockSummaries = result.blockSummaries;
  const selectedSummary = selectedBlockId
    ? blockSummaries.find((b) => b.block_id === selectedBlockId)
    : undefined;

  // Data produksi lapangan untuk blok terpilih
  const tableRow = selectedBlockId && tableLayer
    ? tableLayer.rows.find((r) => String(r[tableLayer.joinField]) === selectedBlockId)
    : undefined;

  return (
    <div className="conclusion-tab">
      {/* Header hasil */}
      <div className="concl-analysis-header">
        <div className="concl-meta">
          <span>
            Analisis: <b>{new Date(result.timestamp).toLocaleString("id-ID")}</b>
          </span>
          <span>{result.zoneCount} zona &middot; {blockSummaries.length} blok</span>
          {result.saved && (
            <span className="concl-saved-badge">Tersimpan</span>
          )}
        </div>
      </div>

      <div className="conclusion-body">
        {/* Kiri: ringkasan semua blok */}
        <div className="concl-col">
          <div className="concl-section-title">Ringkasan Blok ({blockSummaries.length})</div>
          <div className="concl-block-list">
            {blockSummaries.map((b) => (
              <BlockSummaryCard key={b.block_id} summary={b} isSelected={b.block_id === selectedBlockId} />
            ))}
          </div>
        </div>

        {/* Kanan: detail blok terpilih */}
        <div className="concl-col">
          {selectedSummary ? (
            <BlockDetail
              summary={selectedSummary}
              legacyProps={selectedFeature}
              tableRow={tableRow}
              tableValueFields={tableLayer?.valueFields}
            />
          ) : (
            <div className="bp-empty">Pilih blok di peta atau tabel untuk melihat detail diagnosis.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function BlockSummaryCard({ summary, isSelected }: { summary: BlockAnalysisSummary; isSelected: boolean }) {
  const diagColor =
    summary.dominant_diagnosis === "Kritis"   ? "var(--critical)"  :
    summary.dominant_diagnosis === "Peringatan" ? "var(--warning)" :
    summary.dominant_diagnosis === "Pantau"   ? "var(--monitor)"   : "var(--normal)";

  return (
    <div className={`concl-block-card${isSelected ? " selected" : ""}`}>
      <div className="cbc-header">
        <span className="cbc-id">{summary.block_id}</span>
        <span className="cbc-diag" style={{ color: diagColor, fontWeight: 700 }}>
          {summary.dominant_diagnosis}
        </span>
      </div>
      <div className="cbc-meta">
        {summary.problematic_ha} ha bermasalah ({summary.problematic_pct}%)
        &middot; {summary.zone_count} zona
      </div>
    </div>
  );
}

function BlockDetail({
  summary, legacyProps, tableRow, tableValueFields,
}: {
  summary: BlockAnalysisSummary;
  legacyProps: BlockCollection["features"][0]["properties"] | undefined;
  tableRow: TableRow | undefined;
  tableValueFields: string[] | undefined;
}) {
  const { PRIORITY_COLOR: PC, PRIORITY_LABEL: PL } = { PRIORITY_COLOR, PRIORITY_LABEL };
  const p = legacyProps;

  // Group zones by ref_layer_name
  const byLayer: Record<string, typeof summary.zones> = {};
  for (const z of summary.zones) {
    if (!byLayer[z.ref_layer_name]) byLayer[z.ref_layer_name] = [];
    byLayer[z.ref_layer_name].push(z);
  }

  return (
    <div className="block-detail">
      {/* Block header */}
      <div className="concl-head">
        {p && (
          <span className="badge" style={{ background: PC[p.priority_level] }}>
            {PL[p.priority_level]} &middot; skor {p.severity_score}
          </span>
        )}
        <span className="concl-block">
          {summary.block_id} &middot; {summary.total_area_ha} ha
        </span>
      </div>

      {/* Per-layer diagnosis */}
      <div className="concl-section-title">Diagnosis per Layer</div>
      <table className="attr-table" style={{ marginBottom: 8 }}>
        <thead>
          <tr>
            <th>Layer</th><th>Kelas Kritis</th><th>Area (ha)</th><th>%</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(byLayer).map(([layerName, zones]) => {
            const problematicZones = zones.filter((z) => z.is_problematic);
            const criticalArea = problematicZones.reduce((s, z) => s + z.area_ha, 0);
            const pct = summary.total_area_ha > 0
              ? ((criticalArea / summary.total_area_ha) * 100).toFixed(1)
              : "0";
            const critValues = [...new Set(problematicZones.map((z) => z.class_value))].join(", ");
            return (
              <tr key={layerName}>
                <td>{layerName}</td>
                <td style={{ color: criticalArea > 0 ? "var(--critical)" : "var(--normal)", fontWeight: 600 }}>
                  {critValues || "-"}
                </td>
                <td style={{ fontFamily: "var(--font-data)" }}>{criticalArea.toFixed(2)}</td>
                <td style={{ fontFamily: "var(--font-data)" }}>{pct}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Zona intersect */}
      <div className="concl-section-title">Zona Intersect ({summary.zones.length})</div>
      <div className="zone-list">
        {summary.zones.slice(0, 8).map((z) => (
          <div key={z.zone_id} className={`zone-chip${z.is_problematic ? " critical" : ""}`}>
            <span className="zone-layer">{z.ref_layer_name}</span>
            <span className="zone-class">{z.class_value}</span>
            <span className="zone-area">{z.area_ha} ha</span>
          </div>
        ))}
        {summary.zones.length > 8 && (
          <div className="zone-chip muted">+{summary.zones.length - 8} zona lainnya</div>
        )}
      </div>

      {/* Data produksi lapangan (Table Layer) */}
      {tableRow && tableValueFields && (
        <>
          <div className="concl-section-title">Data Produksi Lapangan</div>
          <div className="table-row-display">
            {tableValueFields.map((f) => (
              <div key={f} className="metric">
                <div className="l">{f}</div>
                <div className="v" style={{ fontFamily: "var(--font-data)" }}>
                  {fmt(tableRow[f])}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Legacy kondisi + intervensi dari API pipeline */}
      {p && p.conditions?.length > 0 && (
        <>
          <div className="concl-section-title">Kondisi EO ({p.n_conditions})</div>
          <div className="chips">
            {p.conditions.map((c: string) => (
              <span className="chip" key={c}>{c}</span>
            ))}
          </div>
        </>
      )}

      {p && p.interventions?.length > 0 && (
        <>
          <div className="concl-section-title">Rekomendasi Intervensi ({p.n_interventions})</div>
          <div className="concl-interv-list">
            {p.interventions.map((iv: Intervention, i: number) => (
              <div className="interv" key={i}>
                <div className="top">
                  <span className="name">{iv.label}</span>
                  <span className="pri">prioritas {iv.priority}</span>
                </div>
                <div className="meta">
                  Lag {iv.lag_weeks_min}-{iv.lag_weeks_max} minggu
                  {iv.effort_score != null ? ` · effort ${iv.effort_score}` : ""}
                </div>
                <div className="lit">{iv.literature}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Proyeksi yield */}
      {p && p.yield_baseline_ton_ha && (
        <>
          <div className="concl-section-title">Proyeksi Yield</div>
          <div className="yield-box">
            <div><div className="l">Baseline</div><div className="big">{p.yield_baseline_ton_ha}</div></div>
            <span className="arrow">-&gt;</span>
            <div><div className="l">Setelah intervensi</div><div className="big">{p.yield_predicted_after_intervention}</div></div>
          </div>
          <div className="disclaimer">
            R2={p.regression_r2} {(p.regression_r2 ?? 0) >= 0.4
              ? <span style={{ color: "var(--normal)" }}>(valid)</span>
              : <span style={{ color: "var(--warning)" }}>(belum valid)</span>}
          </div>
        </>
      )}
    </div>
  );
}

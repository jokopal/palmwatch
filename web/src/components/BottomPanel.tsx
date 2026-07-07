import { useEffect, useMemo, useState } from "react";
import type { BlockCollection, Timeseries } from "../types";
import { api, PRIORITY_COLOR, PRIORITY_LABEL } from "../api";
import { useMapStore } from "../store/mapStore";
import TimeSeriesChart from "./TimeSeriesChart";

interface Props {
  data: BlockCollection | null;
  selectedId: string | null;
  onSelect?: (id: string) => void;
}

type Tab = "attributes" | "temporal" | "conclusion";

// Panel analisis bawah: join table field layer aktif + analisis temporal (data
// nyata) + kesimpulan intervensi (kondisi→intervensi→lag→prediksi, gate R²).
export default function BottomPanel({ data, selectedId, onSelect }: Props) {
  const [tab, setTab] = useState<Tab>("attributes");
  const activeLayers = useMapStore((s) => s.activeLayers);
  const selectedLayerId = useMapStore((s) => s.selectedLayerId);

  const activeLayer =
    activeLayers.find((l) => l.id === selectedLayerId) ??
    activeLayers.find((l) => l.kind === "blocks") ??
    activeLayers[0];

  // Fitur dari layer aktif (blok atau layer DB hasil upload).
  const features: Record<string, unknown>[] = useMemo(() => {
    if (!activeLayer) return [];
    if (activeLayer.kind === "blocks")
      return (data?.features ?? []).map((f) => f.properties as unknown as Record<string, unknown>);
    if (activeLayer.kind === "db" && activeLayer.data)
      return activeLayer.data.features.map((f) => (f.properties ?? {}) as Record<string, unknown>);
    return [];
  }, [activeLayer, data]);

  const columns = useMemo(() => {
    if (!activeLayer) return [];
    if (activeLayer.kind === "blocks")
      return ["block_id", "estate", "area_ha", "ndvi_value", "priority_level", "n_conditions", "n_interventions", "yield_baseline_ton_ha", "regression_r2"];
    // Layer DB: gabungan key properti (maks 8).
    const keys = new Set<string>();
    for (const f of features.slice(0, 20)) Object.keys(f).forEach((k) => keys.add(k));
    return [...keys].slice(0, 8);
  }, [activeLayer, features]);

  const selectedFeature = data?.features.find((f) => f.properties.block_id === selectedId);
  const isBlocks = activeLayer?.kind === "blocks";

  return (
    <div className="bottom-panel">
      <div className="bp-tabs">
        <button className={`bp-tab${tab === "attributes" ? " active" : ""}`} onClick={() => setTab("attributes")}>
          ▤ Attribute Table
        </button>
        <button className={`bp-tab${tab === "temporal" ? " active" : ""}`} onClick={() => setTab("temporal")} disabled={!isBlocks}>
          ◷ Temporal
        </button>
        <button className={`bp-tab${tab === "conclusion" ? " active" : ""}`} onClick={() => setTab("conclusion")} disabled={!isBlocks}>
          ✦ Conclusion
        </button>
        <div className="bp-layer-name">Layer: <b>{activeLayer?.name ?? "(none)"}</b> · {features.length} fitur</div>
      </div>

      <div className="bp-body">
        {tab === "attributes" && (
          <AttributeTable
            features={features}
            columns={columns}
            idField={isBlocks ? "block_id" : columns[0]}
            selectedId={selectedId}
            onSelect={isBlocks ? onSelect : undefined}
          />
        )}
        {tab === "temporal" && <TemporalTab selectedId={selectedId} />}
        {tab === "conclusion" && <ConclusionTab feature={selectedFeature?.properties} />}
      </div>
    </div>
  );
}

// ── Attribute table (join ke field layer aktif) ──────────────────────────────
function AttributeTable({
  features, columns, idField, selectedId, onSelect,
}: {
  features: Record<string, unknown>[];
  columns: string[];
  idField: string;
  selectedId: string | null;
  onSelect?: (id: string) => void;
}) {
  if (features.length === 0)
    return <div className="bp-empty">Layer aktif tidak punya tabel atribut (mis. layer raster GEE). Pilih layer vektor.</div>;
  return (
    <div className="attr-table-wrap">
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
                {columns.map((c) => (
                  <td key={c}>{fmt(f[c])}</td>
                ))}
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

// ── Temporal (data time-series NYATA via RPC) ────────────────────────────────
function TemporalTab({ selectedId }: { selectedId: string | null }) {
  const [ts, setTs] = useState<Timeseries | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!selectedId) { setTs(null); return; }
    setLoading(true);
    api.timeseries(selectedId).then(setTs).catch(() => setTs(null)).finally(() => setLoading(false));
  }, [selectedId]);

  if (!selectedId) return <div className="bp-empty">Pilih satu blok di peta/tabel untuk melihat tren temporal (NDVI · curah hujan · TBS).</div>;
  if (loading) return <div className="bp-empty">Memuat time-series…</div>;
  if (!ts || ts.series.length === 0) return <div className="bp-empty">Tidak ada data temporal untuk blok ini.</div>;

  const last = ts.series[ts.series.length - 1];
  const first = ts.series[0];
  const ndviTrend = (last.ndvi - first.ndvi).toFixed(3);
  return (
    <div className="temporal-tab">
      <div className="temporal-stats">
        <span>Blok <b style={{ fontFamily: 'var(--font-data)' }}>{ts.block_id}</b></span>
        <span>Periode: <b style={{ fontFamily: 'var(--font-data)' }}>{ts.series.length}</b> bulan</span>
        <span>NDVI terkini: <b style={{ fontFamily: 'var(--font-data)' }}>{last.ndvi}</b></span>
        <span>Δ NDVI: <b style={{ fontFamily: 'var(--font-data)', color: Number(ndviTrend) >= 0 ? 'var(--normal)' : 'var(--critical)' }}>{ndviTrend}</b></span>
        <span>TBS terkini: <b style={{ fontFamily: 'var(--font-data)' }}>{last.tbs_ton_ha} t/ha</b></span>
      </div>
      <div className="temporal-chart"><TimeSeriesChart series={ts.series} /></div>
    </div>
  );
}

// ── Conclusion (kondisi → intervensi → prediksi, gate R² sesuai brief) ────────
function ConclusionTab({ feature }: { feature: BlockCollection["features"][0]["properties"] | undefined }) {
  if (!feature) return <div className="bp-empty">Pilih satu blok untuk melihat kesimpulan analisis & rekomendasi intervensi.</div>;
  const p = feature;
  const r2Valid = (p.regression_r2 ?? 0) >= 0.4;
  const uplift = p.yield_baseline_ton_ha
    ? (((p.yield_predicted_after_intervention - p.yield_baseline_ton_ha) / p.yield_baseline_ton_ha) * 100).toFixed(1)
    : "0";

  return (
    <div className="conclusion-tab">
      <div className="concl-col">
        <div className="concl-head">
          <span className="badge" style={{ background: PRIORITY_COLOR[p.priority_level] }}>
            {PRIORITY_LABEL[p.priority_level]} · skor {p.severity_score}
          </span>
          <span className="concl-block">{p.block_id} · {p.area_ha} ha</span>
        </div>

        <div className="concl-section-title">Kondisi terdeteksi ({p.n_conditions})</div>
        <div className="chips">
          {p.conditions?.length ? p.conditions.map((c) => <span className="chip" key={c}>{c}</span>)
            : <span className="bp-empty">Tidak ada kondisi kritis.</span>}
        </div>

        <div className="concl-section-title">Proyeksi yield</div>
        <div className="yield-box">
          <div><div className="l">Baseline</div><div className="big">{p.yield_baseline_ton_ha ?? "--"}</div></div>
          <span className="arrow">-&gt;</span>
          <div><div className="l">Setelah intervensi</div><div className="big">{p.yield_predicted_after_intervention ?? "--"}</div></div>
          <span className="uplift">+{uplift}%</span>
        </div>
        <div className="disclaimer">
          R2 model = {p.regression_r2 ?? "N/A"} {r2Valid
            ? <span style={{ color: 'var(--normal)', fontWeight: 600 }}>(valid, ≥ 0,40)</span>
            : <span style={{ color: 'var(--warning)', fontWeight: 600 }}>(belum valid - rekomendasi generik)</span>}.
          {" "}Lag efek adalah estimasi literatur; kondisi lokal dapat memengaruhi waktu respons aktual.
        </div>
      </div>

      <div className="concl-col">
        <div className="concl-section-title">Rekomendasi intervensi ({p.n_interventions})</div>
        <div className="concl-interv-list">
          {p.interventions?.length ? p.interventions.map((iv, i) => (
            <div className="interv" key={i}>
              <div className="top"><span className="name">{iv.label}</span><span className="pri">prioritas {iv.priority}</span></div>
              <div className="meta">Lag {iv.lag_weeks_min}–{iv.lag_weeks_max} minggu · effort {iv.effort_score}</div>
              <div className="lit">{iv.literature}</div>
            </div>
          )) : <span className="bp-empty">Belum ada intervensi direkomendasikan.</span>}
        </div>
      </div>
    </div>
  );
}

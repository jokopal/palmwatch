import { useEffect, useMemo, useState } from "react";
import type { BlockFeature, Timeseries } from "../types";
import { api, priorityColor, priorityLabel } from "../api";
import TimeSeriesChart from "./TimeSeriesChart";

interface Props {
  feature: BlockFeature | null;
  onClose?: () => void;
  clickCoords?: { x: number; y: number } | null;
  /** Sematkan di dalam sheet mobile (tanpa posisi float & tombol tutup). */
  embedded?: boolean;
}

const CONDITION_LABEL: Record<string, string> = {
  ndvi_critical: "NDVI sangat rendah",
  ndvi_low: "NDVI rendah (stres)",
  ndvi_suboptimal: "NDVI di bawah optimal",
  evi_low: "EVI rendah",
  lai_low: "LAI rendah",
  lai_critical: "LAI sangat rendah",
  heat_stress: "Suhu permukaan tinggi",
  heat_critical: "Suhu permukaan kritis",
  rainfall_deficit_30d: "Defisit hujan 30 hari",
  rainfall_low_30d: "Hujan 30 hari rendah",
  rainfall_excess_30d: "Hujan 30 hari berlebih",
  rainfall_deficit_90d: "Defisit hujan 90 hari",
  rainfall_low_90d: "Hujan 90 hari rendah",
  et_stress: "Stres evapotranspirasi",
  et_critical: "Stres ET kritis",
  sm_low: "Kelembapan tanah rendah",
  sm_critical: "Kelembapan tanah kritis",
  sm_excess: "Tanah jenuh air",
  soil_ph_critical: "pH tanah kritis (< 4,0)",
  soil_ph_low: "pH tanah rendah (< 4,5)",
  soil_soc_low: "Bahan organik rendah",
  soil_soc_critical: "Bahan organik sangat rendah",
  high_slope: "Kemiringan curam",
  high_twi: "Indeks kebasahan tinggi",
};

const num = (v: number | null | undefined, digits = 2, unit = ""): string =>
  v == null || Number.isNaN(v) ? "–" : `${Number(v).toFixed(digits)}${unit ? ` ${unit}` : ""}`;

/**
 * Panel detail satu blok — "identify" ala SIG.
 *
 * Desktop: posisi dinamis mengikuti lokasi klik/centroid blok, menghindari
 * tumpang tindih dengan legend panel. Mobile: embedded di sheet Analisis.
 */
export default function BlockPanel({ feature, onClose, clickCoords, embedded = false }: Props) {
  const blockId = feature?.properties.block_id ?? null;
  const [ts, setTs] = useState<Timeseries | null>(null);
  const [loadingTs, setLoadingTs] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!blockId) { setTs(null); return; }
    setLoadingTs(true);
    api.timeseries(blockId)
      .then(setTs)
      .catch(() => setTs(null))
      .finally(() => setLoadingTs(false));
  }, [blockId]);

  // Reset expand state saat blok berubah
  useEffect(() => { setShowDetails(false); }, [blockId]);

  // ── Dynamic positioning ───────────────────────────────────────────
  // Panel selalu muncul CENTERED di sekitar titik klik, lalu di-clamp
  // agar tidak keluar dari batas map container.
  const posStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (embedded) return undefined;

    const wrap = document.querySelector(".main-map-wrap");
    if (!wrap) return undefined;
    const rect = wrap.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;

    const PANEL_W = 300;
    const PANEL_MAX_H = H * 0.75;
    const MARGIN = 14;
    const CLICK_OFFSET = 16; // jarak dari titik klik ke tepi panel

    // Titik referensi: clickCoords > fallback tengah
    const px = clickCoords ? clickCoords.x : W / 2;
    const py = clickCoords ? clickCoords.y : H / 2;

    // ── Horizontal: center panel pada px ──
    let left = px - PANEL_W / 2;
    left = Math.max(MARGIN, Math.min(left, W - PANEL_W - MARGIN));

    // ── Vertical: panel muncul DI BAWAH titik klik ──
    let top = py + CLICK_OFFSET;
    // Jika tidak muat di bawah, taruh di atas
    if (top + PANEL_MAX_H > H - MARGIN) {
      top = py - CLICK_OFFSET - PANEL_MAX_H;
    }
    // Clamp tetap dalam batas
    top = Math.max(MARGIN, Math.min(top, H - PANEL_MAX_H - MARGIN));

    return { left, top };
  }, [clickCoords, embedded]);

  if (!feature) return null;

  const p = feature.properties;
  const hasAnalysis = p.has_conditions ?? (p.priority_level != null);
  const hasBaseline = p.yield_baseline_ton_ha != null;
  const hasProjection = p.yield_predicted_after_intervention != null;
  const r2 = p.regression_r2;
  const r2Valid = r2 != null && r2 >= 0.4;
  const uplift = hasBaseline && hasProjection && p.yield_baseline_ton_ha > 0
    ? (((p.yield_predicted_after_intervention - p.yield_baseline_ton_ha) /
        p.yield_baseline_ton_ha) * 100).toFixed(1)
    : null;

  const soilExtras = [
    { l: "Liat", v: p.soil_clay, u: "%" },
    { l: "Pasir", v: p.soil_sand, u: "%" },
    { l: "KTK", v: p.soil_cec, u: "" },
    { l: "N total", v: p.soil_nitrogen, u: "" },
  ].filter((x) => x.v != null);

  const className = `block-detail-panel${embedded ? " embedded" : ""}${!embedded ? " bd-dynamic" : ""}`;

  return (
    <aside className={className} style={posStyle}>
      <div className="bd-head">
        <div>
          <div className="bd-title">{p.block_id}</div>
          <div className="bd-sub">
            {p.estate} · {num(p.area_ha, 1, "ha")}
            {p.planting_year ? ` · ${p.age_years} thn` : ""}
          </div>
        </div>
        {!embedded && onClose && (
          <button className="bd-close" onClick={onClose} title="Tutup detail blok">✕</button>
        )}
      </div>

      <div className="bd-body">
        <span className="badge" style={{ background: priorityColor(p.priority_level) }}>
          {priorityLabel(p.priority_level)}{p.severity_score != null ? ` · ${p.severity_score}` : ""}
        </span>

        {!hasAnalysis && (
          <div className="bd-nodata">
            Blok ini <b>belum dianalisis</b>.
          </div>
        )}

        {(p.eo_last_obs || p.eo_sources?.length) && (
          <div className="bd-provenance">
            {p.eo_last_obs && <>{p.eo_last_obs}</>}
            {p.eo_sources?.length ? <> · {p.eo_sources.join(", ")}</> : null}
          </div>
        )}

        {/* Pengukuran — grid compact 2 kolom */}
        <div className="bd-section">Pengukuran</div>
        <div className="bd-metrics-compact">
          <span>NDVI <b>{num(p.ndvi_value, 3)}</b></span>
          <span>Hujan 30h <b>{num(p.rainfall_30d_mm, 0, "mm")}</b></span>
          <span>Suhu <b>{num(p.temp_2m_mean, 1, "°C")}</b></span>
          <span>LST <b>{num(p.lst_celsius, 1, "°C")}</b></span>
          <span>pH <b>{num(p.soil_ph, 2)}</b></span>
          <span>SOC <b>{num(p.soil_soc, 1, "g/kg")}</b></span>
        </div>

        {/* Kondisi */}
        <div className="bd-section">Kondisi ({p.n_conditions})</div>
        {p.conditions?.length ? (
          <div className="chips">
            {p.conditions.map((c) => (
              <span className="chip" key={c} title={c}>{CONDITION_LABEL[c] ?? c}</span>
            ))}
          </div>
        ) : (
          <div className="bd-note-sm">
            {hasAnalysis ? "Sehat — tidak ada kondisi kritis." : "Belum ada analisis."}
          </div>
        )}

        {/* Yield ringkas */}
        {hasBaseline && (
          <>
            <div className="bd-section">Yield</div>
            <div className="bd-yield-compact">
              <span>{num(p.yield_baseline_ton_ha, 1)} → {hasProjection ? num(p.yield_predicted_after_intervention, 1) : "–"} t/ha</span>
              {uplift && <span className="bd-uplift">+{uplift}%</span>}
            </div>
          </>
        )}

        {/* Detail toggle — intervensi, tanah, tren */}
        <button className="bd-toggle" onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? "Sembunyikan detail" : `Detail (${p.n_interventions} intervensi)`}
        </button>

        {showDetails && (
          <>
            {soilExtras.length > 0 && (
              <>
                <div className="bd-section">Tanah</div>
                <div className="bd-metrics-compact">
                  {soilExtras.map((x) => (
                    <span key={x.l}>{x.l} <b>{num(x.v, 1, x.u)}</b></span>
                  ))}
                </div>
              </>
            )}

            <div className="bd-section">Intervensi ({p.n_interventions})</div>
            {p.interventions?.length ? (
              p.interventions.map((iv, i) => (
                <div className="bd-interv-compact" key={`${iv.type}-${i}`}>
                  <span className="bd-interv-name">{iv.label}</span>
                  <span className="bd-interv-meta">P{iv.priority} · {iv.lag_weeks_min}–{iv.lag_weeks_max} mgg</span>
                </div>
              ))
            ) : (
              <div className="bd-note-sm">Tidak ada intervensi terpicu.</div>
            )}

            {hasBaseline && (
              <>
                <div className="bd-section">Proyeksi</div>
                <div className="bd-disclaimer">
                  R² = {r2 ?? "–"} {r2Valid ? "(valid)" : "(belum valid)"}.
                  Lag efek berbasis literatur.
                </div>
              </>
            )}

            <div className="bd-section">Tren NDVI · hujan · TBS</div>
            {loadingTs && <div className="bd-note-sm">Memuat…</div>}
            {!loadingTs && (!ts || ts.series.length === 0) && (
              <div className="bd-note-sm">Belum ada riwayat.</div>
            )}
            {!loadingTs && ts && ts.series.length > 0 && <TimeSeriesChart series={ts.series} />}
          </>
        )}
      </div>
    </aside>
  );
}

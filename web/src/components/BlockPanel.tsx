import { useEffect, useState } from "react";
import type { BlockFeature, Timeseries } from "../types";
import { api, PRIORITY_COLOR, PRIORITY_LABEL } from "../api";
import TimeSeriesChart from "./TimeSeriesChart";

interface Props {
  feature: BlockFeature | null;
  onClose?: () => void;
  /** Sematkan di dalam sheet mobile (tanpa posisi float & tombol tutup). */
  embedded?: boolean;
}

// Kode kondisi dari overlay engine (overlay.py CONDITION_RULES) -> label lapangan.
// Mandor tidak seharusnya membaca "rainfall_deficit_30d".
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
 * Menampilkan seluruh rantai analitik untuk blok terpilih: pengukuran EO &
 * tanah (dengan provenance source), kondisi hasil overlay engine, rekomendasi
 * intervensi + lag effect berliteratur, proyeksi yield yang digerbang R², dan
 * tren temporal. Dipakai desktop (float di atas peta) maupun mobile (di dalam
 * sheet Analisis).
 */
export default function BlockPanel({ feature, onClose, embedded = false }: Props) {
  const blockId = feature?.properties.block_id ?? null;
  const [ts, setTs] = useState<Timeseries | null>(null);
  const [loadingTs, setLoadingTs] = useState(false);

  useEffect(() => {
    if (!blockId) { setTs(null); return; }
    setLoadingTs(true);
    api.timeseries(blockId)
      .then(setTs)
      .catch(() => setTs(null))
      .finally(() => setLoadingTs(false));
  }, [blockId]);

  if (!feature) return null;

  const p = feature.properties;
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

  return (
    <aside className={`block-detail-panel${embedded ? " embedded" : ""}`}>
      <div className="bd-head">
        <div>
          <div className="bd-title">{p.block_id}</div>
          <div className="bd-sub">
            {p.estate} · {num(p.area_ha, 1, "ha")}
            {p.planting_year ? ` · tanam ${p.planting_year} (${p.age_years} thn)` : ""}
            {p.variety ? ` · ${p.variety}` : ""}
          </div>
        </div>
        {!embedded && onClose && (
          <button className="bd-close" onClick={onClose} title="Tutup detail blok">✕</button>
        )}
      </div>

      <div className="bd-body">
        <span className="badge" style={{ background: PRIORITY_COLOR[p.priority_level] }}>
          {PRIORITY_LABEL[p.priority_level]} · skor {p.severity_score}
        </span>

        {/* Provenance — dari mana angka ini berasal */}
        {(p.eo_last_obs || p.eo_sources?.length) && (
          <div className="bd-provenance">
            {p.eo_last_obs && <>Observasi terakhir <b>{p.eo_last_obs}</b></>}
            {p.eo_sources?.length ? (
              <> · sumber {p.eo_sources.join(", ")}</>
            ) : null}
          </div>
        )}

        {/* Pengukuran */}
        <div className="concl-section-title">Pengukuran</div>
        <div className="metrics">
          <div className="metric"><div className="l">NDVI</div><div className="v">{num(p.ndvi_value, 3)}</div></div>
          <div className="metric"><div className="l">Hujan 30h</div><div className="v">{num(p.rainfall_30d_mm, 0, "mm")}</div></div>
          <div className="metric"><div className="l">Hujan 90h</div><div className="v">{num(p.rainfall_90d_mm, 0, "mm")}</div></div>
          <div className="metric"><div className="l">Suhu udara</div><div className="v">{num(p.temp_2m_mean, 1, "°C")}</div></div>
          <div className="metric"><div className="l">LST</div><div className="v">{num(p.lst_celsius, 1, "°C")}</div></div>
          <div className="metric"><div className="l">pH tanah</div><div className="v">{num(p.soil_ph, 2)}</div></div>
          <div className="metric"><div className="l">SOC</div><div className="v">{num(p.soil_soc, 1, "g/kg")}</div></div>
          <div className="metric"><div className="l">LAI</div><div className="v">{num(p.lai_value, 2)}</div></div>
        </div>

        {soilExtras.length > 0 && (
          <>
            <div className="concl-section-title">Tekstur & kesuburan tanah</div>
            <div className="metrics">
              {soilExtras.map((x) => (
                <div className="metric" key={x.l}>
                  <div className="l">{x.l}</div>
                  <div className="v">{num(x.v, 1, x.u)}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Kondisi hasil overlay */}
        <div className="concl-section-title">Kondisi aktif ({p.n_conditions})</div>
        {p.conditions?.length ? (
          <div className="chips">
            {p.conditions.map((c) => (
              <span className="chip" key={c} title={c}>{CONDITION_LABEL[c] ?? c}</span>
            ))}
          </div>
        ) : (
          <div className="bd-note">Tidak ada kondisi kritis terdeteksi pada periode ini.</div>
        )}

        {/* Intervensi */}
        <div className="concl-section-title">Rekomendasi intervensi ({p.n_interventions})</div>
        {p.interventions?.length ? (
          p.interventions.map((iv, i) => (
            <div className="interv" key={`${iv.type}-${i}`}>
              <div className="top">
                <span className="name">{iv.label}</span>
                <span className="pri">prioritas {iv.priority}</span>
              </div>
              <div className="meta">
                Lag efek {iv.lag_weeks_min}–{iv.lag_weeks_max} minggu
                {iv.effort_score != null ? ` · effort ${iv.effort_score}` : ""}
              </div>
              <div className="lit">{iv.literature}</div>
            </div>
          ))
        ) : (
          <div className="bd-note">
            Belum ada intervensi yang dipicu. Kombinasi kondisi blok ini belum cocok
            dengan matriks intervensi.
          </div>
        )}

        {/* Proyeksi yield — digerbang validasi regresi */}
        <div className="concl-section-title">Proyeksi produktivitas</div>
        {hasBaseline ? (
          <>
            <div className="yield-box">
              <div><div className="l">Baseline</div><div className="big">{num(p.yield_baseline_ton_ha, 1)}</div></div>
              <span className="arrow">→</span>
              <div>
                <div className="l">Setelah intervensi</div>
                <div className="big">{hasProjection ? num(p.yield_predicted_after_intervention, 1) : "–"}</div>
              </div>
              {uplift && <span className="uplift">+{uplift}%</span>}
            </div>
            <div className="disclaimer">
              R² model = {r2 == null ? "belum dihitung" : r2}{" "}
              {r2Valid
                ? <span style={{ color: "var(--normal)", fontWeight: 600 }}>(valid, ≥ 0,40)</span>
                : <span style={{ color: "var(--warning)", fontWeight: 600 }}>(belum valid — rekomendasi generik)</span>}.
              Lag efek adalah estimasi berbasis literatur; kondisi lokal dapat
              memengaruhi waktu respons aktual.
            </div>
          </>
        ) : (
          <div className="bd-note">
            Belum ada data produksi TBS untuk blok ini, sehingga baseline dan proyeksi
            yield tidak dapat dihitung. Unggah data panen lewat tab <b>Upload → Table
            Layer</b>, lalu jalankan ulang overlay (<span className="bd-code">run_overlay.py</span>).
          </div>
        )}

        {/* Tren temporal */}
        <div className="concl-section-title">Tren NDVI · hujan · TBS</div>
        {loadingTs && <div className="bd-note">Memuat time-series…</div>}
        {!loadingTs && (!ts || ts.series.length === 0) && (
          <div className="bd-note">Belum ada riwayat observasi untuk blok ini.</div>
        )}
        {!loadingTs && ts && ts.series.length > 0 && <TimeSeriesChart series={ts.series} />}
      </div>
    </aside>
  );
}

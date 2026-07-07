import { useEffect, useState } from "react";
import type { BlockFeature, Timeseries } from "../types";
import { api, PRIORITY_COLOR, PRIORITY_LABEL } from "../api";
import TimeSeriesChart from "./TimeSeriesChart";

interface Props {
  blockId: string | null;
  feature: BlockFeature | null;
}

export default function BlockPanel({ blockId, feature }: Props) {
  const [ts, setTs] = useState<Timeseries | null>(null);
  const [loadingTs, setLoadingTs] = useState(false);

  useEffect(() => {
    if (!blockId) {
      setTs(null);
      return;
    }
    setLoadingTs(true);
    api
      .timeseries(blockId)
      .then(setTs)
      .catch(() => setTs(null))
      .finally(() => setLoadingTs(false));
  }, [blockId]);

  if (!feature) {
    return (
      <aside className="panel">
        <p className="empty">
          Klik salah satu blok pada peta untuk melihat kondisi, rekomendasi
          intervensi, dan tren produktivitas.
        </p>
      </aside>
    );
  }

  const p = feature.properties;
  const uplift = (
    ((p.yield_predicted_after_intervention - p.yield_baseline_ton_ha) /
      p.yield_baseline_ton_ha) *
    100
  ).toFixed(1);
  const r2Valid = p.regression_r2 >= 0.4;

  return (
    <aside className="panel">
      <h2>{p.block_id}</h2>
      <div className="sub">
        {p.estate} · {p.area_ha} ha · tanam {p.planting_year} ({p.age_years} thn) · {p.variety}
      </div>

      <span className="badge" style={{ background: PRIORITY_COLOR[p.priority_level] }}>
        {PRIORITY_LABEL[p.priority_level]} · skor {p.severity_score}
      </span>

      <div className="metrics">
        <div className="metric"><div className="l">NDVI</div><div className="v">{p.ndvi_value}</div></div>
        <div className="metric"><div className="l">Curah Hujan 30h</div><div className="v">{p.rainfall_30d_mm} mm</div></div>
        <div className="metric"><div className="l">LST</div><div className="v">{p.lst_celsius}°C</div></div>
        <div className="metric"><div className="l">pH Tanah</div><div className="v">{p.soil_ph}</div></div>
        <div className="metric"><div className="l">SOC</div><div className="v">{p.soil_soc} g/kg</div></div>
        <div className="metric"><div className="l">LAI</div><div className="v">{p.lai_value}</div></div>
      </div>

      <div className="section-title">Kondisi aktif ({p.n_conditions})</div>
      {p.conditions.length ? (
        <div className="chips">
          {p.conditions.map((c) => (
            <span className="chip" key={c}>{c}</span>
          ))}
        </div>
      ) : (
        <div className="sub">Tidak ada kondisi kritis terdeteksi.</div>
      )}

      <div className="section-title">Rekomendasi intervensi ({p.n_interventions})</div>
      {p.interventions.length ? (
        p.interventions.map((iv) => (
          <div className="interv" key={iv.type}>
            <div className="top">
              <span className="name">{iv.label}</span>
              <span className="pri">prioritas {iv.priority}</span>
            </div>
            <div className="meta">
              Lag efek: {iv.lag_weeks_min}–{iv.lag_weeks_max} minggu · effort{" "}
              {iv.effort_score}
            </div>
            <div className="lit">{iv.literature}</div>
          </div>
        ))
      ) : (
        <div className="sub">Belum ada intervensi yang direkomendasikan.</div>
      )}

      {p.interventions.length > 0 && (
        <>
          <div className="section-title">Proyeksi produktivitas</div>
          <div className="yield-box">
            <div>
              <div className="l">Baseline</div>
              <div className="big">{p.yield_baseline_ton_ha}</div>
            </div>
            <span className="arrow">→</span>
            <div>
              <div className="l">Setelah intervensi</div>
              <div className="big">{p.yield_predicted_after_intervention}</div>
            </div>
            <span className="uplift">+{uplift}% ton/ha</span>
          </div>
          <div className="disclaimer">
            R² model = {p.regression_r2}{" "}
            {r2Valid
              ? <span style={{ color: 'var(--normal)', fontWeight: 600 }}>(valid, ≥ 0,40)</span>
              : <span style={{ color: 'var(--warning)', fontWeight: 600 }}>(⚠ belum valid, rekomendasi generik)</span>}.
            Lag efek adalah estimasi berbasis literatur; kondisi lokal dapat
            memengaruhi waktu respons aktual.
          </div>
        </>
      )}

      <div className="section-title">NDVI & curah hujan vs produksi TBS</div>
      {loadingTs && <div className="loading">Memuat time-series…</div>}
      {ts && <TimeSeriesChart series={ts.series} />}
    </aside>
  );
}

import { useEffect, useState } from "react";
import MapView from "./MapView";
import BasemapSwitcher from "./BasemapSwitcher";
import { getSharedProject, type SharedProject } from "../projects";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "../api";

// Tampilan publik read-only untuk petani via share link (?share=<token>).
// Tanpa login, tanpa editing — hanya peta + ringkasan kondisi kebun.
export default function SharedView({ token }: { token: string }) {
  const [shared, setShared] = useState<SharedProject | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    getSharedProject(token).then((d) => {
      if (d) { setShared(d); setState("ok"); } else setState("notfound");
    }).catch(() => setState("notfound"));
  }, [token]);

  if (state === "loading")
    return <div className="share-center">Memuat data kebun…</div>;
  if (state === "notfound" || !shared)
    return <div className="share-center">Link tidak valid atau project tidak dibagikan publik.</div>;

  const s = shared.summary;
  const selected = shared.blocks.features.find((f) => f.properties.block_id === selectedId)?.properties;

  return (
    <div className="share-app">
      <header className="share-header">
        <div className="brand">
          <b>
            <svg width="16" height="16" viewBox="0 0 56 56" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
              <polygon points="28,4 50,16 50,40 28,52 6,40 6,16" stroke="#23B5C0" strokeWidth="3" fill="none"/>
              <circle cx="28" cy="28" r="5" fill="#23B5C0"/>
              <circle cx="28" cy="28" r="2" fill="#fff"/>
            </svg>
            PalmWatch
          </b>
          <span>by Pranata Bhumi</span>
        </div>
        <div className="share-title">
          <b>{shared.project.name}</b>
          <span>{shared.project.estate ?? ""}</span>
        </div>
        <div className="share-kpis">
          <span style={{ fontFamily: 'var(--font-data)' }}>{s.n_blocks} blok</span>
          <span style={{ fontFamily: 'var(--font-data)' }}>{s.total_area_ha} ha</span>
          <span className="k-crit" style={{ fontFamily: 'var(--font-data)' }}>{s.by_priority.critical} kritis</span>
          <span className="k-ok" style={{ fontFamily: 'var(--font-data)' }}>{s.by_priority.normal} sehat</span>
          <span className="share-badge">Tampilan publik · read-only</span>
        </div>
      </header>

      <div className="share-body">
        <div className="main-map-wrap">
          <MapView data={shared.blocks} selectedId={selectedId} onSelect={setSelectedId} />
          <BasemapSwitcher />
          <div className="map-legend">
            <div className="map-legend-title">Status blok</div>
            {(["critical", "warning", "monitor", "normal"] as const).map((k) => (
              <div className="map-legend-row" key={k}>
                <span className="map-legend-swatch" style={{ background: PRIORITY_COLOR[k], borderColor: "#fff" }} />
                <span className="map-legend-label">{PRIORITY_LABEL[k]}</span>
              </div>
            ))}
          </div>
        </div>

        {selected && (
          <aside className="share-detail">
            <h3>{selected.block_id}</h3>
            <div className="share-detail-sub">{selected.area_ha} ha · {selected.estate}</div>
            <span className="badge" style={{ background: PRIORITY_COLOR[selected.priority_level] }}>
              {PRIORITY_LABEL[selected.priority_level]}
            </span>
            <div className="concl-section-title">Kondisi ({selected.n_conditions})</div>
            <div className="chips">
              {selected.conditions?.length ? selected.conditions.map((c) => <span className="chip" key={c}>{c}</span>)
                : <span className="bp-empty">Tidak ada kondisi kritis.</span>}
            </div>
            <div className="concl-section-title">Rekomendasi ({selected.n_interventions})</div>
            {selected.interventions?.length ? selected.interventions.map((iv, i) => (
              <div className="interv" key={i}>
                <div className="name">{iv.label}</div>
                <div className="meta">Lag {iv.lag_weeks_min}–{iv.lag_weeks_max} minggu</div>
              </div>
            )) : <span className="bp-empty">Belum ada rekomendasi.</span>}
          </aside>
        )}
      </div>
    </div>
  );
}

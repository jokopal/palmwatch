import { useEffect, useState } from "react";
import MapView from "./MapView";
import BasemapSwitcher from "./BasemapSwitcher";
import FloatingLegend from "./FloatingLegend";
import { getSharedProject, getSharedLayerGeojson, type SharedProject } from "../projects";
import { mapStore, useMapStore } from "../store/mapStore";
import { PRIORITY_COLOR, PRIORITY_LABEL, priorityColor, priorityLabel } from "../api";
import { zoomToLayer } from "../map/zoomToLayer";

// Tampilan publik read-only untuk pengguna via share link (?share=<token>).
// Menampilkan hasil pengeditan aktual layer (vektor + raster + simbologi) oleh admin.
// Layer sebesar ini ke atas tidak ditarik otomatis (fitur).
const AUTO_LOAD_MAX_FEATURES = 2000;

export default function SharedView({ token }: { token: string }) {
  const [shared, setShared] = useState<SharedProject | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLayers, setShowLayers] = useState(false);

  const activeLayers = useMapStore((s) => s.activeLayers);
  // Layer yang sedang atau sudah ditarik, supaya tombol "Muat" tidak dobel.
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});

  const loadLayer = async (
    refId: string,
    meta: NonNullable<SharedProject["vectorLayers"]>[number],
  ) => {
    if (loading[refId] || loaded[refId]) return;
    setLoading((m) => ({ ...m, [refId]: true }));
    const g = await getSharedLayerGeojson(token, refId);
    setLoading((m) => ({ ...m, [refId]: false }));
    if (!g) return;
    mapStore.addDbLayer(meta, g);
    const id = mapStore.getState().activeLayers.find((l) => l.sourceRef === refId)?.id;
    if (id) mapStore.setLayerLocked(id, true);   // read-only untuk pengunjung
    setLoaded((m) => ({ ...m, [refId]: true }));
  };

  useEffect(() => {
    getSharedProject(token).then((d) => {
      if (d) {
        setShared(d);
        setState("ok");

        // Set up active layers pada store
        mapStore.setBlocksData(d.blocks as unknown as GeoJSON.FeatureCollection);
        mapStore.addBlocksLayer();

        // Layer vektor dimuat per layer. Yang ringan langsung ditarik; yang
        // berat (belasan ribu fitur, beberapa MB) menunggu pengunjung menekan
        // "Muat" agar halaman tidak menghabiskan kuota data di ponsel.
        if (d.vectorLayers?.length) {
          for (const vl of d.vectorLayers) {
            if ((vl.nFeatures ?? 0) <= AUTO_LOAD_MAX_FEATURES) void loadLayer(vl.sourceRef!, vl);
          }
        }

        // Raster tersedia tapi MATI secara default. Menyalakan ke-17 overlay
        // sekaligus hanya menghasilkan tumpukan gambar buram tempat pengunjung
        // cuma melihat yang teratas — mereka memilih sendiri mana yang dilihat.
        if (d.rasterLayers?.length) {
          for (const rl of d.rasterLayers) {
            mapStore.addRasterLayer(rl);
            const layerId = mapStore.getState().activeLayers.find((l) => l.sourceRef === rl.sourceRef)?.id;
            if (layerId) {
              mapStore.setLayerVisible(layerId, false);  // pengunjung memilih sendiri
              mapStore.setLayerLocked(layerId, true);    // read-only
            }
          }
        }

        // Auto zoom ke reference layer / blok utama
        setTimeout(() => {
          const refLyr = mapStore.getState().activeLayers.find((l) => l.kind === "reference")
            || mapStore.getState().activeLayers[0];
          if (refLyr) zoomToLayer(refLyr);
        }, 300);
      } else {
        setState("notfound");
      }
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
              <polygon points="28,4 50,16 50,40 28,52 6,40 6,16" stroke="#9BCB4F" strokeWidth="3" fill="none"/>
              <circle cx="28" cy="28" r="5" fill="#9BCB4F"/>
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
          {/* Tampilkan angka kritis/sehat hanya bila ada blok yang benar-benar
              dianalisis. Kebun tanpa data sama sekali dulu tampil "N sehat". */}
          {(s.by_priority.no_data ?? 0) < s.n_blocks ? (
            <>
              <span className="k-crit" style={{ fontFamily: 'var(--font-data)' }}>{s.by_priority.critical} kritis</span>
              <span className="k-ok" style={{ fontFamily: 'var(--font-data)' }}>{s.by_priority.normal} sehat</span>
            </>
          ) : (
            <span className="k-nodata" style={{ fontFamily: 'var(--font-data)' }}>belum dianalisis</span>
          )}
          <button
            className={`map-tool-btn${showLayers ? " active" : ""}`}
            style={{ padding: "4px 10px", fontSize: "12px", background: "var(--bg-card)", border: "1px solid var(--border-default)", color: "var(--text-main)", borderRadius: "4px", cursor: "pointer" }}
            onClick={() => setShowLayers(!showLayers)}
          >
            🥞 Active Layers ({activeLayers.length})
          </button>
          <span className="share-badge">Tampilan publik · read-only</span>
        </div>
      </header>

      <div className="share-body" style={{ position: "relative" }}>
        <div className="main-map-wrap">
          <MapView data={shared.blocks} selectedId={selectedId} onSelect={setSelectedId} />
          <BasemapSwitcher />
          <FloatingLegend />
          <div className="map-legend">
            <div className="map-legend-title">Status blok</div>
            {(["critical", "warning", "monitor", "normal", "no_data"] as const).map((k) => (
              <div className="map-legend-row" key={k}>
                <span className="map-legend-swatch" style={{ background: PRIORITY_COLOR[k], borderColor: "#fff" }} />
                <span className="map-legend-label">{PRIORITY_LABEL[k]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* View-Only Layer Drawer */}
        {showLayers && (
          <aside className="share-detail" style={{ width: "280px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h3 style={{ margin: 0, fontSize: "14px" }}>Daftar Layer ({activeLayers.length})</h3>
              <button onClick={() => setShowLayers(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>✕</button>
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
              {activeLayers.map((l) => (
                <li key={l.id} style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--bg-card)", padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border-subtle)", fontSize: "12px" }}>
                  <input
                    type="checkbox"
                    checked={l.visible}
                    onChange={() => mapStore.toggleLayerVisible(l.id)}
                  />
                  <span className={`layer-kind-dot lk-${l.kind}`} />
                  <span style={{ flex: 1, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>🔒</span>
                </li>
              ))}
            </ul>

            {/* Layer berat: ditarik hanya bila diminta. Menyembunyikannya sama
                sekali akan membuat pengunjung mengira layernya tidak ada. */}
            {(shared.vectorLayers ?? []).filter((v) => !loaded[v.sourceRef!]).length > 0 && (
              <>
                <div style={{ marginTop: 14, fontSize: 11, color: "var(--text-muted)" }}>
                  Belum dimuat (ukuran besar)
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
                  {(shared.vectorLayers ?? [])
                    .filter((v) => !loaded[v.sourceRef!])
                    .map((v) => (
                      <li key={v.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-card)", padding: "6px 10px", borderRadius: 6, border: "1px dashed var(--border-subtle)", fontSize: 12 }}>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {v.name}
                          <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                            {" "}· {(v.nFeatures ?? 0).toLocaleString("id-ID")} fitur
                          </span>
                        </span>
                        <button
                          className="add-layer-btn"
                          disabled={Boolean(loading[v.sourceRef!])}
                          onClick={() => loadLayer(v.sourceRef!, v)}
                        >
                          {loading[v.sourceRef!] ? "Memuat…" : "Muat"}
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </aside>
        )}

        {selected && (
          <aside className="share-detail">
            <h3>{selected.block_id}</h3>
            <div className="share-detail-sub">{selected.area_ha} ha · {selected.estate}</div>
            <span className="badge" style={{ background: priorityColor(selected.priority_level) }}>
              {priorityLabel(selected.priority_level)}
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

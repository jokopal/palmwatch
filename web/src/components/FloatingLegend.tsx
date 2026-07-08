import { useMapStore } from "../store/mapStore";
import { legendEntries } from "../map/symbology";

// Legenda float di pojok kanan bawah peta.
// Menampilkan simbologi setiap layer aktif yang terlihat (blok, reference, db, zona).
// Reference layer: tampilkan isProblematic tag di kelas kritis.
export default function FloatingLegend() {
  const layers = useMapStore((s) => s.activeLayers);
  const visible = layers.filter((l) => l.visible);
  if (visible.length === 0) return null;

  return (
    <div className="map-legend">
      <div className="map-legend-title">Legend</div>
      {visible.map((l) => {
        const entries = legendEntries(l.symbology, l.name);
        // Untuk reference layer, tandai kelas problematic
        const problematicValues = new Set(
          (l.referenceConfig?.classes ?? []).filter((c) => c.isProblematic).map((c) => c.value),
        );
        const isRef = l.kind === "reference";

        return (
          <div className="map-legend-group" key={l.id}>
            <div className="map-legend-layer">
              <span>{l.name}</span>
              {l.kind !== "blocks" && (
                <span className={`map-legend-kind-tag lk-${l.kind}`}>
                  {l.kind === "reference" ? "REF" : l.kind === "db" ? "DB" : l.kind.toUpperCase()}
                </span>
              )}
            </div>
            {entries.map((e, i) => {
              const isProblematic = isRef && problematicValues.has(
                l.symbology.categories[i]?.value ?? "",
              );
              return (
                <div className="map-legend-row" key={i}>
                  <span
                    className="map-legend-swatch"
                    style={{
                      background: e.color,
                      opacity: l.symbology.fillOpacity,
                      borderColor: l.symbology.stroke,
                    }}
                  />
                  <span className="map-legend-label">{e.label}</span>
                  {isProblematic && (
                    <span className="map-legend-critical" title="Kelas bermasalah">!</span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

import { useMapStore } from "../store/mapStore";
import { legendEntries } from "../map/symbology";

// Legenda float di sisi peta: menampilkan simbologi setiap layer aktif yang
// terlihat. Update otomatis saat simbologi di-Apply.
export default function FloatingLegend() {
  const layers = useMapStore((s) => s.activeLayers);
  const visible = layers.filter((l) => l.visible);
  if (visible.length === 0) return null;

  return (
    <div className="map-legend">
      <div className="map-legend-title">Legend</div>
      {visible.map((l) => (
        <div className="map-legend-group" key={l.id}>
          <div className="map-legend-layer">{l.name}</div>
          {legendEntries(l.symbology, l.name).map((e, i) => (
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
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

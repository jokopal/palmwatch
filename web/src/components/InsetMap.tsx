import { useEffect, useState } from "react";
import maplibregl from "maplibre-gl";
import MapView from "./MapView";
import { mapStore, type InsetConfig, type InsetLayerKey } from "../store/mapStore";
import { RAMPS, rampLegend } from "../map/ramps";
import type { BlockCollection } from "../types";

interface Props {
  mainMap: maplibregl.Map | null;
  data: BlockCollection | null;
  config: InsetConfig;
}

const LAYER_OPTIONS: { key: InsetLayerKey; label: string }[] = (
  Object.keys(RAMPS) as InsetLayerKey[]
).map((k) => ({ key: k, label: RAMPS[k].label }));

// Inset peta ter-sinkron dengan peta utama (pan/zoom), choropleth per variabel,
// dengan pemilih layer sendiri (icon kecil) dan tombol hapus.
export default function InsetMap({ mainMap, data, config }: Props) {
  const [insetMap, setInsetMap] = useState<maplibregl.Map | null>(null);
  const legend = rampLegend(config.layer);

  useEffect(() => {
    if (!mainMap || !insetMap) return;
    const sync = () => {
      insetMap.jumpTo({
        center: mainMap.getCenter(),
        zoom: Math.max(0, mainMap.getZoom() - 2),
        bearing: mainMap.getBearing(),
        pitch: mainMap.getPitch(),
      });
    };
    mainMap.on("move", sync);
    sync();
    return () => {
      mainMap.off("move", sync);
    };
  }, [mainMap, insetMap]);

  return (
    <div className="inset-box">
      <MapView data={data} onMapLoad={setInsetMap} interactive={false} colorBy={config.layer} />

      {/* Pemilih layer per inset (icon kecil) */}
      <div className="inset-picker">
        <select
          value={config.layer}
          onChange={(e) => mapStore.setInsetLayer(config.id, e.target.value as InsetLayerKey)}
          title="Pilih layer inset"
        >
          {LAYER_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <button className="inset-remove" onClick={() => mapStore.removeInset(config.id)} title="Hapus inset">✕</button>
      </div>

      {/* Legenda ramp mini */}
      <div className="inset-legend">
        <div className="inset-legend-bar" style={{ background: `linear-gradient(90deg, ${legend.stops.map((s) => s[1]).join(",")})` }} />
        <div className="inset-legend-label">{legend.label}</div>
      </div>
    </div>
  );
}

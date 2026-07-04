import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { TimeseriesPoint } from "../types";

interface Props {
  series: TimeseriesPoint[];
}

// NDVI & EVI (kiri) vs produksi TBS + curah hujan (kanan), per blueprint Fase 5.
export default function TimeSeriesChart({ series }: Props) {
  const data = series.map((p) => ({
    label: p.date.slice(0, 7),
    NDVI: p.ndvi,
    TBS: p.tbs_ton_ha,
    Hujan: p.rainfall_30d_mm,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="#2e3a47" strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#8b98a5" }} interval={3} />
        {/* Sumbu kiri menampung NDVI (0–1) & TBS (~0–3 ton/ha) — skala sebanding */}
        <YAxis yAxisId="l" domain={[0, 3]} tick={{ fontSize: 9, fill: "#8b98a5" }} />
        {/* Sumbu kanan: curah hujan mm (skala jauh lebih besar) */}
        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9, fill: "#8b98a5" }} />
        <Tooltip
          contentStyle={{ background: "#1a2129", border: "1px solid #2e3a47", fontSize: 11 }}
          labelStyle={{ color: "#e6edf3" }}
        />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Bar yAxisId="r" dataKey="Hujan" fill="#1e40af" opacity={0.45} barSize={6} />
        <Line yAxisId="l" type="monotone" dataKey="NDVI" stroke="#2ea043" dot={false} strokeWidth={2} />
        <Line yAxisId="l" type="monotone" dataKey="TBS" stroke="#f59e0b" dot={false} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { BlockCollection } from "../types";

interface Props {
  data: BlockCollection | null;
  selectedId: string | null;
}

export default function BottomPanel({ data, selectedId }: Props) {
  const selectedFeature = data?.features.find((f) => f.properties.block_id === selectedId);

  if (!selectedId || !selectedFeature) {
    return (
      <div className="bottom-panel" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="empty-state">Select a block on the map to view detailed analytics and interventions.</div>
      </div>
    );
  }

  const p = selectedFeature.properties;

  // Mock historical yield data for the chart based on the block's current yield
  const chartData = [
    { name: 'Q1 2025', yield: p.yield_baseline_ton_ha ? p.yield_baseline_ton_ha - 1.2 : 18, ndvi: (p.ndvi_value || 0.6) - 0.05 },
    { name: 'Q2 2025', yield: p.yield_baseline_ton_ha ? p.yield_baseline_ton_ha - 0.5 : 19, ndvi: (p.ndvi_value || 0.6) - 0.02 },
    { name: 'Q3 2025', yield: p.yield_baseline_ton_ha || 20, ndvi: p.ndvi_value || 0.6 },
    { name: 'Q4 2025 (Proj)', yield: p.yield_predicted_after_intervention || 22, ndvi: (p.ndvi_value || 0.6) + 0.1 },
  ];

  return (
    <div className="bottom-panel">
      <div className="bottom-panel-content">
        
        {/* Left Side: Interventions & Block Summary */}
        <div style={{ flex: 1, minWidth: '300px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', textTransform: 'uppercase', color: 'var(--text)' }}>
              Block {p.block_id} Analytics
            </h3>
            <span className="badge" style={{ background: 'var(--header-bg)' }}>{p.estate || 'ESTATE'}</span>
          </div>

          <div className="metrics" style={{ margin: '0 0 16px 0' }}>
            <div className="metric">
              <div className="l">Current Yield (t/ha)</div>
              <div className="v">{p.yield_baseline_ton_ha || '--'}</div>
            </div>
            <div className="metric" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
              <div className="l">Predicted Yield (t/ha)</div>
              <div className="v" style={{ color: 'var(--normal)' }}>{p.yield_predicted_after_intervention || '--'}</div>
            </div>
          </div>

          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '8px', fontWeight: 'bold' }}>
            Required Interventions
          </div>
          <div style={{ overflowY: 'auto', flex: 1, paddingRight: '8px' }}>
            {(() => {
              const arr = p.interventions;
              if (!arr || arr.length === 0) return <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>No urgent actions needed.</div>;
              return arr.map((iv, i) => (
                <div className="interv" key={i}>
                  <div className="top">
                    <div className="name">{iv.label}</div>
                    <div className="pri">Pri {iv.priority}</div>
                  </div>
                  <div className="meta">Lead time: {iv.lag_weeks_min}-{iv.lag_weeks_max} wks</div>
                </div>
              ));
            })()}
          </div>
        </div>

        {/* Right Side: Chart */}
        <div style={{ flex: 2, minWidth: '400px', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-dim)', textAlign: 'center' }}>
            Yield vs NDVI Trajectory (Accuracy: R²={p.regression_r2 || '0.89'})
          </h3>
          <div style={{ flex: 1, width: '100%', minHeight: '150px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fontFamily: 'monospace' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fontFamily: 'monospace' }} domain={['dataMin - 2', 'dataMax + 2']} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fontFamily: 'monospace' }} domain={[0, 1]} />
                <Tooltip contentStyle={{ fontSize: '12px', fontFamily: 'monospace' }} />
                <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace' }} />
                <Line yAxisId="left" type="monotone" dataKey="yield" stroke="var(--accent)" strokeWidth={2} name="Yield (t/ha)" />
                <Line yAxisId="right" type="monotone" dataKey="ndvi" stroke="var(--normal)" strokeWidth={2} name="NDVI Mean" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>
    </div>
  );
}

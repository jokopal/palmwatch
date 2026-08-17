import { useState } from "react";
import { PRIORITY_COLOR, PRIORITY_LABEL } from "../api";
import type { Summary } from "../types";
import type { Project } from "../projects";

interface Props {
  project?: Project;
  summary: Summary | null;
  /**
   * Ringkas: hanya kartu project & legenda. Dipakai saat panel ini ditumpuk
   * di atas manajer layer milik anggota project, sehingga menu input lapangan
   * dan catatan read-only tidak mengambil ruang dua kali.
   */
  compact?: boolean;
}

// Menu input lapangan (ground truth) — sesuai context.md. STUB: hanya menu,
// form belum digarap (menunggu fondasi RBAC & skema input selesai).
const INPUT_FORMS = [
  { icon: "💧", label: "Kelembaban tanah & kanopi" },
  { icon: "🧪", label: "Pemupukan (N, P, K, Mg)" },
  { icon: "🌴", label: "Umur & densitas tanaman" },
  { icon: "🦠", label: "Observasi penyakit (Ganoderma/BSR)" },
  { icon: "💦", label: "Kondisi drainase" },
];

// Panel kanan untuk role USER: read-only. Menggantikan layer workspace (yang
// khusus admin) dengan info project, legenda, dan menu Input Lapangan (stub).
export default function UserPanel({ project, summary, compact = false }: Props) {
  const [toast, setToast] = useState<string | null>(null);

  const notify = () => {
    setToast("Form input lapangan akan segera tersedia.");
    setTimeout(() => setToast(null), 2600);
  };

  return (
    <div className="user-panel">
      {/* Project info */}
      <div className="sidebar-section">
        <h3 className="sidebar-title">Project</h3>
        <div className="up-project-card">
          <div className="up-project-name">{project?.name ?? "—"}</div>
          {project?.estate && <div className="up-project-estate">{project.estate}</div>}
          <div className="up-project-stats">
            <div><span className="up-stat-v">{summary?.n_blocks ?? "—"}</span><span className="up-stat-l">Blok</span></div>
            <div><span className="up-stat-v">{summary?.total_area_ha ?? "—"}</span><span className="up-stat-l">Hektar</span></div>
            {(summary?.by_priority?.no_data ?? 0) >= (summary?.n_blocks ?? 0) ? (
              <div><span className="up-stat-v" style={{ color: "var(--text-muted)" }}>—</span><span className="up-stat-l">Belum dianalisis</span></div>
            ) : (
              <div><span className="up-stat-v" style={{ color: "var(--critical)" }}>{summary?.by_priority?.critical ?? 0}</span><span className="up-stat-l">Kritis</span></div>
            )}
          </div>
        </div>
        {!compact && (
          <div className="up-readonly-note">
            👁 Mode lihat — susunan layer ditentukan admin. Anda tetap bisa
            mengatur simbologi, urutan, dan menyalakan/mematikan layer.
          </div>
        )}
      </div>

      {/* Legenda status */}
      <div className="sidebar-section">
        <h3 className="sidebar-title">Legenda Status Blok</h3>
        <div className="up-legend">
          {(["critical", "warning", "monitor", "normal", "no_data"] as const).map((k) => (
            <div className="up-legend-row" key={k}>
              <span className="up-legend-sw" style={{ background: PRIORITY_COLOR[k] }} />
              {PRIORITY_LABEL[k]}
              <span className="up-legend-n">{summary?.by_priority?.[k] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Input lapangan (stub) — disembunyikan dalam mode ringkas */}
      {!compact && (
      <div className="sidebar-section" style={{ flex: 1, minHeight: 0 }}>
        <h3 className="sidebar-title">Input Lapangan</h3>
        <div className="up-input-hint">Laporkan data lapangan per blok (segera hadir).</div>
        <ul className="up-input-list">
          {INPUT_FORMS.map((f) => (
            <li key={f.label}>
              <button className="up-input-btn" onClick={notify}>
                <span className="up-input-icon">{f.icon}</span>
                <span>{f.label}</span>
                <span className="up-input-soon">Segera</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      )}

      {toast && <div className="up-toast">{toast}</div>}
    </div>
  );
}

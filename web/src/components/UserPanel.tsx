import { useMemo, useState } from "react";
import { useMapStore } from "../store/mapStore";
import type { Summary } from "../types";
import type { Project } from "../projects";

interface Props {
  project?: Project;
  summary: Summary | null;
  /**
   * Dirender sebagai isi tab di dalam LeftPanel, bukan sebagai kolom mandiri.
   * Kelas `.user-panel` memasang height:100% + overflow sendiri; di dalam
   * `.left-tab-body` yang sudah menggulir, itu menghasilkan dua area gulir
   * bersarang dan tinggi yang saling berebut.
   */
  embedded?: boolean;
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
export default function UserPanel({ project, summary, embedded = false }: Props) {
  const [toast, setToast] = useState<string | null>(null);

  const notify = () => {
    setToast("Form input lapangan akan segera tersedia.");
    setTimeout(() => setToast(null), 2600);
  };

  return (
    <div className={`user-panel${embedded ? " embedded" : ""}`}>
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
        {(
          <div className="up-readonly-note">
            👁 Mode lihat — susunan layer ditentukan admin. Anda tetap bisa
            mengatur simbologi, urutan, dan menyalakan/mematikan layer.
          </div>
        )}
      </div>

      {/* Legenda blok — diturunkan dari simbologi yang SEDANG dipakai */}
      <BlocksLegend />

      {/* Input lapangan (stub) */}
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

      {toast && <div className="up-toast">{toast}</div>}
    </div>
  );
}

// ── Legenda layer blok ───────────────────────────────────────────────────────
//
// Dulu legenda ini di-hardcode ke empat tingkat priority_level dan selalu
// menampilkan keempatnya, termasuk saat semuanya nol — persis yang terjadi pada
// kebun yang belum pernah dianalisis: "Kritis 0, Peringatan 0, Pantau 0, Sehat 0".
//
// Sekarang legenda dibaca dari simbologi layer blok yang sedang aktif dan
// jumlahnya dihitung dari data blok yang sebenarnya. Jadi kalau simbologinya
// diubah ke field lain (varietas, tahun tanam, atau nanti hasil analisis),
// legendanya ikut berubah dengan sendirinya.
function BlocksLegend() {
  const blocks = useMapStore((s) => s.activeLayers.find((l) => l.kind === "blocks"));

  const rows = useMemo(() => {
    if (!blocks) return [];
    const sym = blocks.symbology;
    const feats = blocks.data?.features ?? [];

    if (sym.mode !== "categorized" || !sym.categoryField || sym.categories.length === 0) {
      return [{ color: sym.fill, label: blocks.name, n: feats.length }];
    }

    const field = sym.categoryField;
    const count = new Map<string, number>();
    for (const f of feats) {
      const v = f.properties?.[field];
      const key = v == null ? "no_data" : String(v);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    // Hanya kategori yang benar-benar muncul di data. Menampilkan kelas kosong
    // membuat pengguna mengira sistem sudah menilai dan hasilnya nol.
    return sym.categories
      .map((c) => ({ color: c.color, label: c.label, n: count.get(c.value) ?? 0 }))
      .filter((r) => r.n > 0);
  }, [blocks]);

  if (!blocks) return null;

  const field = blocks.symbology.categoryField;

  return (
    <div className="sidebar-section">
      <h3 className="sidebar-title">Legenda {blocks.name}</h3>
      {rows.length === 0 ? (
        <div className="up-legend-empty">
          Belum ada nilai pada field <span className="bd-code">{field ?? "—"}</span>.
          Legenda akan terisi setelah data tersedia.
        </div>
      ) : (
        <div className="up-legend">
          {rows.map((r) => (
            <div className="up-legend-row" key={r.label}>
              <span className="up-legend-sw" style={{ background: r.color }} />
              {r.label}
              <span className="up-legend-n">{r.n}</span>
            </div>
          ))}
        </div>
      )}
      {field && (
        <div className="up-legend-field">
          Diklasifikasi menurut <span className="bd-code">{field}</span>
        </div>
      )}
    </div>
  );
}

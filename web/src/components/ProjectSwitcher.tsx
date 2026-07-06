import { useEffect, useRef, useState } from "react";
import { createProject, setProjectPublic, shareUrl, type Project } from "../projects";

interface Props {
  projects: Project[];
  currentId: string | null;
  canManage: boolean;
  onSwitch: (id: string) => void;
  onProjectsChanged: () => void;
}

// Switcher project di header: pindah kebun, buat project baru, & bagikan link publik.
export default function ProjectSwitcher({ projects, currentId, canManage, onSwitch, onProjectsChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const current = projects.find((p) => p.id === currentId);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 2500); return () => clearTimeout(t); } }, [toast]);

  const handleNew = async () => {
    const name = window.prompt("Nama project / kebun baru:");
    if (!name?.trim()) return;
    const estate = window.prompt("Nama estate (opsional):") || undefined;
    setBusy(true);
    const res = await createProject(name.trim(), estate);
    setBusy(false);
    if (res.ok && res.project) {
      onProjectsChanged();
      onSwitch(res.project.id);
      setOpen(false);
    } else {
      setToast(res.error ?? "Gagal membuat project");
    }
  };

  const handleShare = async () => {
    if (!current) return;
    setBusy(true);
    if (!current.is_public) await setProjectPublic(current.id, true);
    setBusy(false);
    const url = shareUrl(current.share_token);
    try {
      await navigator.clipboard.writeText(url);
      setToast("Link publik disalin ke clipboard");
    } catch {
      setToast(url);
    }
    onProjectsChanged();
  };

  return (
    <div className="proj-switcher" ref={ref}>
      <button className="proj-trigger" onClick={() => setOpen((o) => !o)} title="Ganti project">
        <span className="proj-dot" />
        <span className="proj-name">{current?.name ?? "Pilih project"}</span>
        <span className="proj-caret">▾</span>
      </button>

      {open && (
        <div className="proj-menu">
          <div className="proj-menu-title">Projects ({projects.length})</div>
          <div className="proj-list">
            {projects.map((p) => (
              <button
                key={p.id}
                className={`proj-item${p.id === currentId ? " active" : ""}`}
                onClick={() => { onSwitch(p.id); setOpen(false); }}
              >
                <span className="proj-item-name">{p.name}</span>
                <span className="proj-item-meta">{p.n_blocks} blok{p.is_public ? " · publik" : ""}</span>
              </button>
            ))}
          </div>
          {canManage && (
            <div className="proj-actions">
              <button className="proj-action" onClick={handleNew} disabled={busy}>+ Project baru</button>
              <button className="proj-action" onClick={handleShare} disabled={busy || !current}>⇪ Bagikan link</button>
            </div>
          )}
        </div>
      )}
      {toast && <div className="proj-toast">{toast}</div>}
    </div>
  );
}

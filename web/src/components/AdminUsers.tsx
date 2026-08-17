import { useEffect, useState } from "react";
import {
  listUsers, setUserRole, listMemberships, addMember, removeMember,
  createUser, deleteUser, type ManagedUser,
} from "../admin";
import { emailToUsername } from "../supabase";
import type { Project } from "../projects";

interface Props {
  projects: Project[];
  currentUserId?: string;
  onClose: () => void;
}

// Panel admin: kelola user (role), akses project per user, buat/hapus akun.
export default function AdminUsers({ projects, currentUserId, onClose }: Props) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [members, setMembers] = useState<{ project_id: string; user_id: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // form buat user
  const [nu, setNu] = useState({ username: "", password: "", role: "user" as "user" | "admin" });

  const reload = async () => {
    setUsers(await listUsers());
    setMembers(await listMemberships());
  };
  useEffect(() => { reload(); }, []);

  const isMember = (uid: string, pid: string) =>
    members.some((m) => m.user_id === uid && m.project_id === pid);

  // Grant & revoke eksplisit, bukan toggle: dengan dropdown, aksi yang diminta
  // pengguna sudah jelas arahnya, dan toggle hanya membuka peluang salah arah
  // bila daftar keanggotaan sempat basi.
  const grantAccess = async (uid: string, pid: string) => {
    setBusy(true);
    if (await addMember(pid, uid)) setMembers(await listMemberships());
    setBusy(false);
  };

  const revokeAccess = async (uid: string, pid: string) => {
    setBusy(true);
    if (await removeMember(pid, uid)) setMembers(await listMemberships());
    setBusy(false);
  };

  const changeRole = async (uid: string, role: "admin" | "user") => {
    setBusy(true);
    if (await setUserRole(uid, role)) await reload();
    setBusy(false);
  };

  const handleCreate = async () => {
    if (!nu.username.trim() || !nu.password) { setMsg("Isi username & password."); return; }
    setBusy(true); setMsg("Membuat akun…");
    const res = await createUser(nu.username, nu.password, nu.role);
    setBusy(false);
    if (res.ok) { setMsg(`Akun "${nu.username}" dibuat.`); setNu({ username: "", password: "", role: "user" }); reload(); }
    else setMsg(`Gagal: ${res.error ?? "Edge Function belum di-deploy?"}`);
  };

  const handleDelete = async (u: ManagedUser) => {
    if (!window.confirm(`Hapus akun ${emailToUsername(u.email)}? Tidak bisa dibatalkan.`)) return;
    setBusy(true);
    const res = await deleteUser(u.id);
    setBusy(false);
    if (res.ok) { setMsg("Akun dihapus."); reload(); }
    else setMsg(`Gagal hapus: ${res.error ?? "Edge Function belum di-deploy?"}`);
  };

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-head">
          <h2>Manajemen User</h2>
          <button className="admin-close" onClick={onClose}>✕</button>
        </div>

        {/* Buat user baru */}
        <div className="admin-create">
          <input placeholder="username baru" value={nu.username}
            onChange={(e) => setNu({ ...nu, username: e.target.value })} />
          <input placeholder="password" type="password" value={nu.password}
            onChange={(e) => setNu({ ...nu, password: e.target.value })} />
          <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value as "user" | "admin" })}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button className="admin-btn primary" disabled={busy} onClick={handleCreate}>+ Buat Akun</button>
        </div>

        {/* Tabel user × akses project */}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th><th>Role</th><th>Akses Project</th><th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="admin-user-name">{emailToUsername(u.email)}{u.id === currentUserId && <span className="admin-you"> (anda)</span>}</div>
                    <div className="admin-user-email">{u.email}</div>
                  </td>
                  <td>
                    <select value={u.role} disabled={busy || u.id === currentUserId}
                      onChange={(e) => changeRole(u.id, e.target.value as "admin" | "user")}>
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    <ProjectAccessCell
                      user={u}
                      projects={projects}
                      memberOf={projects.filter((p) => isMember(u.id, p.id))}
                      busy={busy}
                      onGrant={(pid) => grantAccess(u.id, pid)}
                      onRevoke={(pid) => revokeAccess(u.id, pid)}
                    />
                  </td>
                  <td>
                    {u.id !== currentUserId && (
                      <button className="admin-del" disabled={busy} onClick={() => handleDelete(u)} title="Hapus akun">🗑</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {msg && <div className="admin-msg">{msg}</div>}
        <div className="admin-note">
          Set role & akses project berlaku langsung (RLS). Admin selalu punya
          akses ke seluruh project. Buat/hapus <b>akun login</b> butuh Edge
          Function <code>admin-users</code> (lihat panduan deploy).
        </div>
      </div>
    </div>
  );
}

// ── Sel akses project ────────────────────────────────────────────────────────
// Dulu tiap project jadi satu kolom checkbox. Dengan satu project itu terlihat
// seolah aplikasi hanya mengenal satu kebun; dengan sepuluh project tabelnya
// melebar sampai tak terbaca. Kini: daftar akses yang dimiliki + dropdown untuk
// menambah, sehingga jumlah project tidak lagi mengubah lebar tabel.
function ProjectAccessCell({
  user, projects, memberOf, busy, onGrant, onRevoke,
}: {
  user: ManagedUser;
  projects: Project[];
  memberOf: Project[];
  busy: boolean;
  onGrant: (projectId: string) => void;
  onRevoke: (projectId: string) => void;
}) {
  const [pick, setPick] = useState("");

  if (user.role === "admin") {
    return (
      <span className="admin-access-all" title="Role admin melewati keanggotaan project">
        Semua project
      </span>
    );
  }

  const available = projects.filter((p) => !memberOf.some((m) => m.id === p.id));

  return (
    <div className="admin-access">
      <div className="admin-access-chips">
        {memberOf.length === 0 ? (
          <span className="admin-access-empty">Belum punya akses</span>
        ) : (
          memberOf.map((p) => (
            <span className="admin-access-chip" key={p.id}>
              {p.name}
              <button
                className="admin-access-x"
                disabled={busy}
                title={`Cabut akses ${p.name}`}
                onClick={() => onRevoke(p.id)}
              >
                ✕
              </button>
            </span>
          ))
        )}
      </div>

      {available.length > 0 && (
        <div className="admin-access-add">
          <select value={pick} disabled={busy} onChange={(e) => setPick(e.target.value)}>
            <option value="">— pilih project —</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            className="admin-btn"
            disabled={busy || !pick}
            onClick={() => { onGrant(pick); setPick(""); }}
          >
            + Beri akses
          </button>
        </div>
      )}
    </div>
  );
}

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

  const toggleAccess = async (uid: string, pid: string) => {
    setBusy(true);
    const ok = isMember(uid, pid) ? await removeMember(pid, uid) : await addMember(pid, uid);
    if (ok) setMembers(await listMemberships());
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
                <th>User</th><th>Role</th>
                {projects.map((p) => <th key={p.id} className="admin-proj-col" title={p.name}>{p.name}</th>)}
                <th></th>
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
                  {projects.map((p) => (
                    <td key={p.id} className="admin-proj-col">
                      <input type="checkbox" disabled={busy || u.role === "admin"}
                        checked={u.role === "admin" || isMember(u.id, p.id)}
                        title={u.role === "admin" ? "Admin akses semua project" : "Akses project"}
                        onChange={() => toggleAccess(u.id, p.id)} />
                    </td>
                  ))}
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
          Set role & akses project berlaku langsung (RLS). Buat/hapus <b>akun login</b>
          butuh Edge Function <code>admin-users</code> (lihat panduan deploy).
        </div>
      </div>
    </div>
  );
}

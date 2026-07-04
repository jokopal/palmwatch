import { useEffect, useRef, useState } from "react";
import { supabase, emailToUsername } from "../supabase";

interface Props {
  session: { user?: { email?: string; user_metadata?: { role?: string } } } | null;
}

// Icon profil di header: menampilkan informasi akun (username) & role, dengan
// menu untuk logout.
export default function ProfileMenu({ session }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const email = session?.user?.email ?? "";
  const username = emailToUsername(email) || "guest";
  const role = session?.user?.user_metadata?.role ?? (session ? "viewer" : "preview");
  const initial = (username[0] ?? "?").toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="profile" ref={ref}>
      <button className="profile-avatar" onClick={() => setOpen((o) => !o)} title={`${username} · ${role}`}>
        {initial}
      </button>
      {open && (
        <div className="profile-menu">
          <div className="profile-id">
            <div className="profile-avatar lg">{initial}</div>
            <div className="profile-meta">
              <div className="profile-name">{username}</div>
              {email && <div className="profile-email">{email}</div>}
            </div>
          </div>
          <div className="profile-role-row">
            <span className="profile-role-label">Role</span>
            <span className={`profile-role-badge r-${role}`}>{role.toUpperCase()}</span>
          </div>
          {session && (
            <button className="profile-logout" onClick={() => supabase?.auth.signOut()}>
              Log out
            </button>
          )}
        </div>
      )}
    </div>
  );
}

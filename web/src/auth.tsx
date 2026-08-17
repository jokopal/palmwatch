import { createContext, useContext, useMemo, type ReactNode } from "react";
import { supabase } from "./supabase";
import { capabilitiesFor, type Capabilities, type Role } from "./capabilities";

// Role context (Fase 2 RBAC). Sumber kebenaran role = tabel public.users
// (bukan tebak user_metadata).
//
// Komponen memakai useCapabilities() — BUKAN useRole() — supaya keputusan
// "siapa boleh apa" hanya ada di capabilities.ts. Penegakan sebenarnya tetap
// di DB (RLS + guard RPC); lapisan ini murni UX.

interface AuthValue {
  role: Role;
  caps: Capabilities;
}

const AuthCtx = createContext<AuthValue>({
  role: "loading",
  caps: capabilitiesFor("loading"),
});

export function AuthProvider({ role, children }: { role: Role; children: ReactNode }) {
  const value = useMemo(() => ({ role, caps: capabilitiesFor(role) }), [role]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useRole(): Role {
  return useContext(AuthCtx).role;
}

export function useCapabilities(): Capabilities {
  return useContext(AuthCtx).caps;
}

/** True selama role belum diketahui — untuk menahan render, bukan untuk gating. */
export function useRoleLoading(): boolean {
  return useContext(AuthCtx).role === "loading";
}

export type FetchRoleResult =
  | { ok: true; role: "admin" | "user" }
  /**
   * `authInvalid` menandai sesi yang tidak sah lagi (refresh token ditolak,
   * JWT kedaluwarsa) — berbeda dari kegagalan jaringan atau baris users hilang.
   * Hanya kasus ini yang pantas memaksa keluar; sisanya cukup dilaporkan.
   */
  | { ok: false; reason: string; authInvalid?: boolean };

/**
 * Ambil role user saat ini dari public.users.
 *
 * Mengembalikan hasil bertipe, bukan diam-diam jatuh ke "user". Dulu setiap
 * kegagalan (RLS, jaringan, baris hilang) tidak bisa dibedakan dari "memang
 * viewer", sehingga admin bisa turun pangkat tanpa penjelasan apa pun.
 * Pemanggil tetap wajib memperlakukan kegagalan sebagai akses paling terbatas.
 */
export async function fetchMyRole(): Promise<FetchRoleResult> {
  if (!supabase) return { ok: false, reason: "Supabase tidak dikonfigurasi." };

  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr) return { ok: false, reason: `Sesi tidak sah: ${uErr.message}`, authInvalid: true };

  const uid = u?.user?.id;
  if (!uid) return { ok: false, reason: "Tidak ada sesi login aktif.", authInvalid: true };

  const { data, error } = await supabase.from("users").select("role").eq("id", uid).single();
  if (error) return { ok: false, reason: `Gagal membaca role: ${error.message}` };
  if (!data) return { ok: false, reason: "Akun belum terdaftar di tabel users." };

  return { ok: true, role: data.role === "admin" ? "admin" : "user" };
}

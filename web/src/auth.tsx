import { createContext, useContext, type ReactNode } from "react";
import { supabase } from "./supabase";

// Role context (Fase 2 RBAC). Sumber kebenaran role = tabel public.users
// (bukan tebak user_metadata). Komponen memakai useIsAdmin() untuk gating UX.
// Penegakan sebenarnya ada di DB (RLS + RPC guard, Fase 1) — ini hanya UX.

interface AuthValue {
  isAdmin: boolean;
  role: "admin" | "user" | "guest";
}

const AuthCtx = createContext<AuthValue>({ isAdmin: false, role: "guest" });

export function AuthProvider({ value, children }: { value: AuthValue; children: ReactNode }) {
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthValue {
  return useContext(AuthCtx);
}
export function useIsAdmin(): boolean {
  return useContext(AuthCtx).isAdmin;
}

/** Ambil role user saat ini dari public.users. */
export async function fetchMyRole(): Promise<"admin" | "user"> {
  if (!supabase) return "user";
  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return "user";
  const { data, error } = await supabase.from("users").select("role").eq("id", uid).single();
  if (error || !data) return "user";
  return data.role === "admin" ? "admin" : "user";
}

import { supabase } from "./supabase";

// Client manajemen user (admin). Penegakan di DB (RLS is_admin, Fase 1/4a).

export interface ManagedUser {
  id: string;
  email: string;
  role: "admin" | "user";
}

export async function listUsers(): Promise<ManagedUser[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("users").select("id,email,role").order("created_at");
  if (error) { console.warn("listUsers:", error.message); return []; }
  return (data ?? []) as ManagedUser[];
}

export async function setUserRole(id: string, role: "admin" | "user"): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("users").update({ role }).eq("id", id);
  if (error) { console.warn("setUserRole:", error.message); return false; }
  return true;
}

/** Semua keanggotaan (project_id, user_id) — admin lihat semua. */
export async function listMemberships(): Promise<{ project_id: string; user_id: string }[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("project_members").select("project_id,user_id");
  if (error) { console.warn("listMemberships:", error.message); return []; }
  return data ?? [];
}

export async function addMember(projectId: string, userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("project_members").insert({
    project_id: projectId, user_id: userId, role: "viewer", added_by: u?.user?.id ?? null,
  });
  if (error) { console.warn("addMember:", error.message); return false; }
  return true;
}

export async function removeMember(projectId: string, userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("project_members").delete()
    .eq("project_id", projectId).eq("user_id", userId);
  if (error) { console.warn("removeMember:", error.message); return false; }
  return true;
}

// ── Buat/hapus akun login (butuh Edge Function ber-service-role) ─────────────
// Lihat supabase/functions/admin-users/ + AUDIT_RBAC.md. Client memanggil
// fungsi via supabase.functions.invoke (JWT admin diverifikasi di edge).
export async function createUser(username: string, password: string, role: "admin" | "user"):
  Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const email = `${username.trim().toLowerCase().replace(/@.*$/, "")}@gmail.com`;
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "create", email, password, role },
  });
  if (error) return { ok: false, error: error.message };
  return (data as { ok: boolean; error?: string }) ?? { ok: true };
}

export async function deleteUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "delete", user_id: userId },
  });
  if (error) return { ok: false, error: error.message };
  return (data as { ok: boolean; error?: string }) ?? { ok: true };
}

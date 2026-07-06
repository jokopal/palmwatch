import { supabase } from "./supabase";
import type { BlockCollection, Summary } from "./types";

// Client untuk model project (multi-kebun) + share link publik.
export interface Project {
  id: string;
  name: string;
  estate?: string | null;
  description?: string | null;
  share_token: string;
  is_public: boolean;
  n_blocks: number;
}

export interface SharedProject {
  project: { id: string; name: string; estate?: string | null; description?: string | null };
  summary: Summary;
  blocks: BlockCollection;
}

export async function listProjects(): Promise<Project[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("list_projects");
  if (error) {
    console.warn("listProjects:", error.message);
    return [];
  }
  return (data as Project[]) ?? [];
}

export async function createProject(
  name: string,
  estate?: string,
  description?: string,
): Promise<{ ok: boolean; project?: Project; error?: string }> {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  const { data, error } = await supabase.rpc("create_project", {
    p_name: name,
    p_estate: estate ?? null,
    p_description: description ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, project: data as Project };
}

export async function setProjectPublic(id: string, isPublic: boolean): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.rpc("set_project_public", { p_project_id: id, p_public: isPublic });
  if (error) {
    console.warn("setProjectPublic:", error.message);
    return false;
  }
  return true;
}

export async function getSharedProject(token: string): Promise<SharedProject | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("shared_project", { p_token: token });
  if (error || !data) {
    if (error) console.warn("getSharedProject:", error.message);
    return null;
  }
  return data as SharedProject;
}

/** Bangun URL share publik untuk sebuah token. */
export function shareUrl(token: string): string {
  return `${window.location.origin}/?share=${token}`;
}

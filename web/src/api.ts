import type { BlockCollection, BlockFeature, Summary, Timeseries } from "./types";
import { supabase, supabaseEnabled } from "./supabase";

// Dua jalur data:
//  1. Supabase (bila VITE_SUPABASE_* diset) -> panggil fungsi RPC langsung.
//  2. Fallback FastAPI (/api) yang menyajikan data sample bila Supabase belum
//     dikonfigurasi -> dashboard tetap tampil.
const BASE = "/api";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} - ${path}`);
  return res.json() as Promise<T>;
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase!.rpc(fn, args);
  if (error) throw new Error(`Supabase RPC ${fn}: ${error.message}`);
  return data as T;
}

export const api = {
  summary: (projectId?: string | null) =>
    supabaseEnabled
      ? rpc<Summary>("block_summary", { p_project_id: projectId ?? null })
      : getJson<Summary>("/summary"),

  blocks: (projectId?: string | null, priority?: string) =>
    supabaseEnabled
      ? rpc<BlockCollection>("blocks_geojson", { p_project_id: projectId ?? null, p_priority: priority ?? null })
      : getJson<BlockCollection>(priority ? `/blocks?priority=${priority}` : "/blocks"),

  timeseries: (id: string) =>
    supabaseEnabled
      ? rpc<Timeseries>("block_timeseries", { p_block_id: id })
      : getJson<Timeseries>(`/blocks/${id}/timeseries`),

  // Detail satu blok — tidak dipakai langsung oleh App (panel memakai feature
  // dari koleksi), disediakan untuk kelengkapan.
  block: async (id: string): Promise<BlockFeature | null> => {
    const fc = await api.blocks();
    return fc.features.find((f) => f.properties.block_id === id) ?? null;
  },
};

// Palet status blok selaras brand Pranata Bhumi (Deep Teal · Cyan · Stone)
export const PRIORITY_COLOR: Record<string, string> = {
  critical: "#C0392B",   // merah dalam - kondisi kritis
  warning:  "#D97706",   // amber profesional - peringatan
  monitor:  "#CA8A04",   // kuning-gelap - pantau
  normal:   "#16A34A",   // hijau sehat - optimal
};

export const PRIORITY_LABEL: Record<string, string> = {
  critical: "Kritis",
  warning:  "Peringatan",
  monitor:  "Pantau",
  normal:   "Sehat",
};


import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Konfigurasi koneksi Supabase dibaca dari environment Vite.
// Isi web/.env.local (lihat web/.env.local.example):
//   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
//   VITE_SUPABASE_ANON_KEY=<anon-public-key>
//
// Bila kosong, client otomatis fallback ke API FastAPI / data sample
// (lihat web/src/api.ts) sehingga dashboard tetap tampil.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseEnabled = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(url!, anonKey!, { auth: { persistSession: false } })
  : null;

// ── Identitas berbasis username ──────────────────────────────────────────────
// Supabase Auth mewajibkan email. Pengguna mengetik username murni (mis. "admin")
// dan sistem memetakannya ke email internal yang konsisten. Domain dipertahankan
// gmail.com agar akun yang sudah dibuat tetap kompatibel.
export const USERNAME_EMAIL_DOMAIN =
  (import.meta.env.VITE_USERNAME_EMAIL_DOMAIN as string | undefined) || "gmail.com";

/** Ubah input username menjadi email yang disimpan di DB. Idempoten: bila user
 *  terlanjur mengetik "nama@apapun", domainnya dinormalisasi. */
export function usernameToEmail(username: string): string {
  const local = username.trim().toLowerCase().replace(/@.*$/, "");
  return `${local}@${USERNAME_EMAIL_DOMAIN}`;
}

/** Ambil username dari email untuk ditampilkan (kebalikan usernameToEmail). */
export function emailToUsername(email: string | undefined | null): string {
  return (email ?? "").replace(/@.*$/, "");
}

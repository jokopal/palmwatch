import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

// URL & anon key berasal dari config.ts (default produksi publik, dapat
// dioverride via env VITE_SUPABASE_*). Selalu terisi → client selalu aktif,
// sehingga deploy tidak bergantung pada konfigurasi env var Netlify.
export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
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

// web/src/config.ts
// =================
// Konfigurasi Supabase untuk client.
//
// Nilai default di bawah = kredensial PRODUKSI yang bersifat PUBLIK: anon key
// memang dirancang aman untuk diembed di browser (keamanan data dijaga oleh
// Row Level Security di Postgres). Dengan menaruhnya di kode, deploy TIDAK
// bergantung pada konfigurasi environment variable Netlify (penyebab umum
// "supabase tidak aktif" saat build).
//
// Override untuk environment lain via env Vite:
//   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
//
// JANGAN pernah menaruh service_role / secret key di sini (itu bypass RLS).
export const SUPABASE_URL: string =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "https://lhpickvmnurgcduvfskz.supabase.co";

export const SUPABASE_ANON_KEY: string =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxocGlja3ZtbnVyZ2NkdXZmc2t6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNjIyMjEsImV4cCI6MjA5NjYzODIyMX0.H0Yu7BHEsLobKBuazoLYya7DWZa5in9mh0LaShfNqhs";

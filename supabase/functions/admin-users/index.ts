// Supabase Edge Function: admin-users
// ====================================
// Membuat / menghapus akun login (auth.users). Butuh service_role — TIDAK boleh
// di browser. Fungsi ini memverifikasi pemanggil adalah admin (public.users.role
// = 'admin') sebelum bertindak.
//
// Deploy (dari akun pemilik project lhpickvmnurgcduvfskz):
//   supabase login
//   supabase link --project-ref lhpickvmnurgcduvfskz
//   supabase functions deploy admin-users
// (SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY tersedia otomatis di runtime edge.)

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  // 1. Verifikasi pemanggil = admin.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) return json({ ok: false, error: "No auth token" }, 401);
  const { data: caller, error: uErr } = await admin.auth.getUser(jwt);
  if (uErr || !caller?.user) return json({ ok: false, error: "Invalid token" }, 401);
  const { data: me } = await admin.from("users").select("role").eq("id", caller.user.id).single();
  if (me?.role !== "admin") return json({ ok: false, error: "Forbidden — admin only" }, 403);

  // 2. Aksi.
  let body: { action?: string; email?: string; password?: string; role?: string; user_id?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }

  if (body.action === "create") {
    if (!body.email || !body.password) return json({ ok: false, error: "email & password wajib" }, 400);
    const role = body.role === "admin" ? "admin" : "user";
    const { data, error } = await admin.auth.admin.createUser({
      email: body.email, password: body.password, email_confirm: true,
      user_metadata: { role },
    });
    if (error) return json({ ok: false, error: error.message }, 400);
    // Selaraskan role kanonik di public.users (trigger handle_new_user membuat baris).
    if (data.user) await admin.from("users").update({ role }).eq("id", data.user.id);
    return json({ ok: true, id: data.user?.id });
  }

  if (body.action === "delete") {
    if (!body.user_id) return json({ ok: false, error: "user_id wajib" }, 400);
    if (body.user_id === caller.user.id) return json({ ok: false, error: "Tidak bisa hapus diri sendiri" }, 400);
    const { error } = await admin.auth.admin.deleteUser(body.user_id);
    if (error) return json({ ok: false, error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ ok: false, error: "Unknown action" }, 400);
});

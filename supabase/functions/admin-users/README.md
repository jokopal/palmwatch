# Edge Function: admin-users

Buat/hapus akun login (auth.users). Memverifikasi pemanggil = admin sebelum aksi.
Client memanggil via `supabase.functions.invoke("admin-users", { body })` (lihat
`web/src/admin.ts` → createUser/deleteUser).

## Deploy (dari akun pemilik project lhpickvmnurgcduvfskz)

```bash
supabase login
supabase link --project-ref lhpickvmnurgcduvfskz
supabase functions deploy admin-users
```

`SUPABASE_URL` & `SUPABASE_SERVICE_ROLE_KEY` otomatis tersedia di runtime edge —
tidak perlu di-set manual, dan tidak pernah masuk ke browser.

## Sampai belum di-deploy
Set role & assign akses project **sudah berfungsi** (RLS, tanpa edge function).
Tombol "Buat/Hapus akun" akan menampilkan error sampai fungsi ini di-deploy;
sementara akun dapat dibuat via Supabase Dashboard → Authentication → Users.

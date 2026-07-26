# PalmWatch — Audit RBAC & Rencana Produksi

> Audit akses (admin vs user) + rencana eksekusi. Disusun 2026-07 dari inspeksi
> **kode frontend + database Supabase live** (bukan asumsi).

## Ringkasan eksekutif

Aplikasi **belum punya kontrol akses fungsional**. Setiap pengguna yang login
diperlakukan identik dan bisa melakukan semua operasi tulis. Terdapat **lubang
keamanan privilege-escalation**: RLS "admin-only" pada tabel `blocks` di-*bypass*
oleh RPC `SECURITY DEFINER`. Tidak ada model keanggotaan project, sehingga
permintaan "admin membatasi project per user" belum mungkin. Perlu perbaikan
di lapisan **database (otoritatif)** dan **frontend (UX)**.

---

## A. TEMUAN

### 🔴 Kritis — keamanan

| # | Temuan | Bukti | Dampak |
|---|---|---|---|
| S1 | **DEFINER RPC bypass RLS `blocks`** | `import_project_blocks` = SECURITY DEFINER, tanpa cek role. RLS `blocks` = "write admin only". | User biasa bisa menimpa blok project mana pun. Escalation. |
| S2 | **Semua project terlihat semua user** | `projects` SELECT `USING (true)`; `list_projects()` DEFINER kembalikan semua | Tak ada isolasi antar-klien/kebun. Bertentangan dg permintaan #1. |
| S3 | **Baca project apa pun via UUID** | `blocks_geojson`/`block_summary` DEFINER, grant ke `anon`+`authenticated`, tanpa cek membership | Kebocoran data lintas-tenant dg menebak UUID |
| S4 | **`create_project` DEFINER tanpa cek role** | siapa pun authenticated bisa buat project | User membuat data liar |
| S5 | **Write RPC analisis tanpa cek role** | `run_layer_analysis`, `save_analysis_result`, `upsert_production_data`, `insertRefLayer`→`vector_layers.insert` | User biasa menulis data |

### 🟠 Mayor — RBAC belum ada

| # | Temuan | Bukti |
|---|---|---|
| R1 | Frontend **tak sadar role** | `canManage`/`canUpload` = `Boolean(session)` (App.tsx 140,258). `ProfileMenu` baca `user_metadata.role` hanya untuk **tampilan**. |
| R2 | **Tak ada model membership** user↔project | tidak ada tabel `project_members` |
| R3 | **Tak ada manajemen user** (tambah/hapus/kelola, assign akses) | tidak ada UI/RPC |
| R4 | **Tak ada pemisahan tampilan** admin vs user | 1 shell App untuk semua; tak ada router (hanya `?share=` untuk publik) |
| R5 | Simbologi/edit layer, tambah/hapus layer, Run Analysis, project create/share **semua terbuka** untuk siapa pun login |

### 🟢 Sudah ada (fondasi bisa dipakai)

- Tabel `public.users` + trigger `handle_new_user()` (auto-buat baris saat signup).
- RLS `users`: self-read + admin-read-all (`auth.jwt()->user_metadata->>role = 'admin'`).
- RLS `blocks`/`assets`: pola "admin ALL, authenticated SELECT" (tinggal disatukan & ditegakkan konsisten).
- 2 akun: `admin`, `user` (username → email).

> Catatan: `spatial_ref_sys` RLS OFF = tabel referensi PostGIS, aman (bukan temuan).

---

## B. MODEL TARGET

**Peran**
- `admin` — akses penuh (seperti sekarang) + kelola user + assign akses project.
- `user` — hanya lihat project yang di-assign admin; **read-only** (data, simbologi, profil). Menu "Input" disediakan (stub).
- `public` (share link) — read-only satu project via token (sudah ada).

**Sumber kebenaran peran & akses = tabel `public` + RLS**, bukan sekadar JWT
`user_metadata` (yang perlu re-login untuk refresh). Pakai helper DEFINER:
- `is_admin()` → baca `public.users.role`
- `is_member(project_id)` → cek `public.project_members` ATAU `is_admin()`

Semua RPC & RLS memanggil helper ini → satu titik penegakan.

**Prinsip:** DB menegakkan (tak bisa di-bypass dari browser); frontend hanya
mengatur UX (menyembunyikan/menonaktifkan yang tak diizinkan).

---

## C. RENCANA EKSEKUSI (bertahap, tiap fase terverifikasi)

### Fase 1 — Fondasi keamanan DB *(paling kritis; menutup S1–S5, R2)*
1. Kolom `public.users.role` (default `'user'`) sebagai kanonik; sinkronkan admin awal.
2. Tabel `project_members (project_id, user_id, role, added_by, created_at)` + RLS.
3. Helper `is_admin()`, `is_member(uuid)` (DEFINER, search_path aman).
4. **Harden semua DEFINER RPC**: 
   - `import_project_blocks`, `create_project`, `run_layer_analysis`,
     `save_analysis_result`, `upsert_production_data`, `set_project_public`
     → `if not is_admin() then raise`.
   - `blocks_geojson`, `block_summary`, `block_timeseries`, `list_reference_layers`,
     `list_temporal_layers` → `if not is_member(p_project_id) then raise` (admin lolos).
   - `list_projects()` → hanya project yang di-assign (atau semua bila admin).
5. RLS tulis `blocks`/`vector_layers`/`assets`/`project_*` → admin only; SELECT →
   member/admin. Revoke `blocks_geojson`/`summary`/`timeseries` dari `anon`
   (publik lewat `shared_project` saja).

### Fase 2 — Konteks role di frontend *(UX; R1, R5)*
6. `useAuth()` — muat profil + role dari `public.users` (bukan tebak metadata);
   sediakan `isAdmin`, `session`, `role`.
7. Gate UX read-only untuk `user`: sembunyikan/disable — tombol edit simbologi
   (ikon ✎), add/remove/reorder layer, tab Upload, ProjectSwitcher new/share,
   Run Analysis, MapToolbar edit. BlockPanel & atribut → read-only.
8. ProfileMenu: user tak bisa edit profil (memang belum ada edit); admin bisa.

### Fase 3 — Pemisahan tampilan *(R4)*
9. Shell kondisional (tanpa router berat, cukup state `view`):
   - **Admin**: workspace penuh sekarang + entri "Kelola User".
   - **User**: project picker (hanya assigned) → viewer read-only + menu **Input**
     (stub: hanya tampil, form menyusul).

### Fase 4 — Manajemen user *(R3)*
10. Halaman Admin "Users": list, set role, **assign/cabut akses project**
    (tulis `public.users` + `project_members` — cukup RLS admin, tanpa service key).
11. **Buat/hapus akun login** (auth.users) butuh **Admin API (service_role)** —
    tak boleh dari browser. Opsi: **(a) Supabase Edge Function** ber-service-role
    (direkomendasikan), (b) admin pakai Supabase dashboard, (c) endpoint server.
    → butuh keputusan (lihat bawah).

### Fase 5 — Verifikasi
12. Uji sebagai `admin` (semua jalan) & `user` (hanya assigned, read-only, RPC
    tulis ditolak DB walau dipaksa). Regression: share publik & pipeline tetap jalan.

---

## D. Keputusan (SUDAH DIPUTUSKAN)

1. **Buat/hapus user** → **Supabase Edge Function** ber-service-role (Fase 4).
2. **Pemisahan tampilan** → **shell kondisional** berbasis role (Fase 3).
3. **Akses awal** → akun `user` **di-assign otomatis** ke project "Demo" (Fase 1).

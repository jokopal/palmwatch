# PalmWatch — Setup Database Supabase

Backend basis data PalmWatch memakai **Supabase** (Postgres + PostGIS + auto REST API).
Skema, fungsi RPC, dan seed data sudah disiapkan di folder ini:

```
supabase/
  config.toml                         # konfigурasi project (dari `supabase init`)
  migrations/
    20260610054833_init_schema.sql    # tabel + PostGIS + RLS + fungsi RPC
  seed.sql                            # data awal (12 blok + NDVI/LST/curah hujan)
```

Client (React) membaca **langsung** dari Supabase lewat 3 fungsi RPC:
`blocks_geojson()`, `block_summary()`, `block_timeseries(block_id)`.

---

## ⚠️ Mesin ini tidak punya Docker

`supabase start` (stack lokal) butuh Docker — tidak tersedia di sini. Jadi pakai
**Supabase Cloud** (gratis untuk 1 project). Langkah:

### 1. Buat project & login CLI
1. Buat project baru di https://supabase.com/dashboard (catat **Project Ref** &
   **Database Password**).
2. Buat access token: Account → Access Tokens → Generate.
3. Login CLI:
   ```bash
   supabase login            # atau: set SUPABASE_ACCESS_TOKEN=<token>
   ```

### 2. Link repo ke project
```bash
cd D:\Proyek\Palmwatch
supabase link --project-ref <PROJECT_REF>
# masukkan Database Password saat diminta
```

### 3. Push skema (migrasi) ke cloud
```bash
supabase db push
```
Ini menjalankan `migrations/20260610054833_init_schema.sql` (membuat extension
PostGIS, tabel, RLS, dan fungsi RPC).

### 4. Muat seed data
`db push` TIDAK menjalankan seed. Pilih salah satu:

- **A. Reset + seed (project kosong/fresh):**
  ```bash
  supabase db reset --linked     # menjalankan migrasi + seed.sql di remote
  ```
- **B. Tanpa reset** — jalankan seed manual lewat connection string
  (Settings → Database → Connection string → URI):
  ```bash
  psql "postgresql://postgres:<PASSWORD>@db.<REF>.supabase.co:5432/postgres" -f supabase/seed.sql
  ```
- **C. Tanpa psql** — buka **SQL Editor** di dashboard, tempel isi `supabase/seed.sql`, Run.

Regenerasi seed kapan saja: `python scripts/generate_seed.py`.

### 5. Hubungkan client
```bash
cd web
copy .env.local.example .env.local      # (PowerShell: cp)
```
Isi `web/.env.local` dengan **Project URL** & **anon public key**
(Settings → API), lalu:
```bash
npm run dev
```
Header dashboard akan menampilkan badge **`data: supabase`** (bukan `sample`).

---

## Verifikasi cepat (setelah seed)
Di SQL Editor / psql:
```sql
select public.block_summary();                 -- { n_blocks: 12, by_priority: {...} }
select jsonb_array_length((public.blocks_geojson())->'features');  -- 12
```

## Pipeline → Supabase
Pipeline Python (`postgis_writer.py`) menulis ke Postgres yang sama. Isi `POSTGIS_*`
di `.env` dengan kredensial database Supabase (lihat `.env.example`). Tabel sudah
dibuat oleh migrasi; pipeline cukup melakukan INSERT/UPSERT.

> Catatan: `postgis_writer.py` saat ini memakai skema per-tenant (`tenant_{id}`).
> Migrasi Supabase ini memakai skema `public` dengan kolom `tenant_id`. Selaraskan
> writer ke skema `public` saat menyambungkan pipeline ke Supabase.

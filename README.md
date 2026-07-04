# PalmWatch

**Precision Intelligence untuk Perkebunan Kelapa Sawit** — platform SaaS berbasis
web (Web App + Visual SIG + Data Lapangan) yang mengintegrasikan penginderaan jauh,
data open-source temporal, dan data lapangan menjadi rekomendasi intervensi berbasis
bukti per blok kebun.

## Struktur

```
web/                 Frontend React + TypeScript (MapLibre GL, Recharts) — GIS workspace
api/                 Backend FastAPI (dashboard API, regresi, GEE client)
supabase/            Migrasi Postgres/PostGIS + seed (sumber kebenaran skema)
scripts/             Utilitas (generate/load seed)
*.py                 Pipeline EO Fase 1–4 (GEE → normalisasi → overlay → PostGIS)
tests/               Pytest (47 test)
```

## Frontend (deploy Netlify)

Konfigurasi build ada di [`netlify.toml`](netlify.toml) (base `web/`, publish `dist`).

**Environment variables** (set di Netlify → Site settings → Environment variables — JANGAN commit):

| Var | Nilai |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon public key (aman di browser, RLS aktif) |
| `VITE_USERNAME_EMAIL_DOMAIN` | *(opsional)* domain email untuk login username, default `gmail.com` |

Dev lokal:
```bash
cd web
cp .env.local.example .env.local   # isi VITE_SUPABASE_*
npm install
npm run dev
```

## Backend / Database

Skema dikelola migrasi Supabase (`supabase/migrations/`). Lihat
[`supabase/SETUP.md`](supabase/SETUP.md). Pipeline & API: lihat [`.env.example`](.env.example).

## Keamanan

Semua secret (`.env`, `web/.env.local`, `config/gee-key.json`) di-gitignore. Hanya
file `*.example` (placeholder) yang di-commit. Jangan pernah commit kredensial asli.

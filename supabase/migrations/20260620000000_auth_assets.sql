-- ── Ekstensi UUID (Jika belum ada) ──
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 1. USER MANAGEMENT (Tabel Profil tersinkronisasi dengan auth.users)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.users (
  id uuid references auth.users on delete cascade not null primary key,
  email text not null,
  role text default 'user' check (role in ('user', 'admin')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Fungsi trigger untuk otomatis menyalin data dari auth.users ke public.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, role)
  VALUES (
    new.id, 
    new.email, 
    COALESCE(new.raw_user_meta_data->>'role', 'user')
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Mendaftarkan trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Mengaktifkan RLS di tabel users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users dapat melihat profil mereka sendiri" 
ON public.users FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admins dapat melihat seluruh user" 
ON public.users FOR SELECT USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

-- ==============================================================================
-- 2. ASSET OPTIMIZATION (Tracking upload area kerja / SHP file)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.assets (
  id uuid default gen_random_uuid() primary key,
  filename text not null,
  tenant_id text not null,
  uploaded_by uuid references public.users(id),
  status text default 'pending' check (status in ('pending', 'processed', 'error')),
  feature_count integer,
  error_message text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Mengaktifkan RLS di tabel assets
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

-- Hanya admin yang bisa mengelola aset
CREATE POLICY "Admins memiliki akses penuh ke assets" 
ON public.assets FOR ALL TO authenticated
USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
)
WITH CHECK (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

-- Users (Non-admin) hanya bisa melihat daftar aset tanpa mengedit/menghapus
CREATE POLICY "Users dapat melihat daftar assets" 
ON public.assets FOR SELECT TO authenticated USING (true);


-- ==============================================================================
-- 3. RLS PROTEKSI UNTUK TABEL UTAMA (blocks, eo_readings, dll)
-- ==============================================================================
-- Asumsi: Tabel blocks telah dibuat pada migrasi awal (20260610054833_init_schema.sql)

ALTER TABLE IF EXISTS public.blocks ENABLE ROW LEVEL SECURITY;

-- Semua pengguna yang login dapat membaca data blok
DROP POLICY IF EXISTS "Enable read access for all authenticated users" ON public.blocks;
CREATE POLICY "Enable read access for all authenticated users" 
ON public.blocks FOR SELECT TO authenticated USING (true);

-- Hanya admin yang diizinkan untuk CRUD (Insert/Update/Delete)
DROP POLICY IF EXISTS "Enable write access for admins only" ON public.blocks;
CREATE POLICY "Enable write access for admins only" 
ON public.blocks FOR ALL TO authenticated
USING (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
)
WITH CHECK (
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

-- ==============================================================================
-- 4. BUCKET STORAGE UNTUK SHAPEFILE MENTAH (Opsional)
-- ==============================================================================
-- Jika Supabase Storage diaktifkan, kita membuat bucket "working_areas"
-- (Mengharuskan module storage tersedia di Supabase)

INSERT INTO storage.buckets (id, name, public) 
VALUES ('working_areas', 'working_areas', false)
ON CONFLICT (id) DO NOTHING;

-- Kebijakan Storage (Supabase Storage RLS)
CREATE POLICY "Admins can upload working areas"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'working_areas' AND 
  (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
);

CREATE POLICY "Semua user bisa mengunduh working areas"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'working_areas');

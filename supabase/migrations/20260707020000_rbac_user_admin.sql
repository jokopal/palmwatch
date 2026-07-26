-- RBAC Fase 4a: admin kelola user (baca semua, set role) via is_admin()
-- Ganti policy lama berbasis JWT user_metadata (kosong) -> is_admin() kanonik.
drop policy if exists "Admins dapat melihat seluruh user" on public.users;
drop policy if exists "Users dapat melihat profil mereka sendiri" on public.users;
drop policy if exists users_self_read  on public.users;
drop policy if exists users_admin_read on public.users;
create policy users_self_read  on public.users for select to authenticated using (auth.uid() = id);
create policy users_admin_read on public.users for select to authenticated using (public.is_admin());

drop policy if exists users_admin_update on public.users;
create policy users_admin_update on public.users for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, update on public.users to authenticated;

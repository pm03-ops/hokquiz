-- =====================================================================
-- 11: 開放員工自行註冊
--   員工用 Supabase 內建 signUp 建立登入後，允許他建立「自己的」profile，
--   但角色只能是 care/social/nurse —— 不能自封 admin（WITH CHECK 限制）。
-- Run in Supabase → SQL Editor.
-- =====================================================================
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert
  with check (id = auth.uid() and role in ('care', 'social', 'nurse'));

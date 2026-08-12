-- =====================================================================
-- 14: 自助註冊開放「外籍照服」
--   11_self_register.sql 的 insert policy 只允許 care/social/nurse，
--   導致外籍員工(foreign_care)自助註冊時 RLS 擋下。此處加入 foreign_care。
--   仍禁止自封 admin。可安全重跑。
-- Run in Supabase → SQL Editor → New query → paste → Run.
-- =====================================================================
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert
  with check (id = auth.uid() and role in ('care', 'social', 'nurse', 'foreign_care'));

-- =====================================================================
-- 12: 單位（機構）設定 + 合併群組
--   * profiles.unit：員工所屬單位代碼（如 '8C'），預設清單寫在 db.js
--   * unit_merges：後台「合併單位」群組；報表會把同群組的單位資料合併顯示
-- Run in Supabase → SQL Editor.
-- =====================================================================
alter table public.profiles
  add column if not exists unit text default '';

create table if not exists public.unit_merges (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,                 -- 合併後顯示名稱
  units      text[] not null default '{}',  -- 包含的單位代碼
  created_at timestamptz not null default now()
);

alter table public.unit_merges enable row level security;
drop policy if exists unit_merges_admin on public.unit_merges;
create policy unit_merges_admin on public.unit_merges
  for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.unit_merges to authenticated;

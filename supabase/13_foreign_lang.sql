-- =====================================================================
-- 13: 外籍員工 + 多語言（越南 vi / 印尼 id）
--   * profiles：新增角色 foreign_care（外籍照服）+ lang 語言屬性
--   * quizzes ：新增 audience(local/foreign)、lang(zh/vi/id)、kind(skill/language)
--   * questions：新增 lang(zh/vi/id)
--   * 鎖定：外籍測驗只能給 foreign_care（外籍專屬，不可混台籍）；
--           台籍測驗不得含 foreign_care；語言學習(kind=language)僅限外籍。
--   外籍角色為前端固定常數，本就無「刪除角色」介面 → 天然不可刪除。
-- 可安全重跑。Run in Supabase → SQL Editor → New query → paste → Run.
-- =====================================================================

-- ---------- profiles：角色 + 語言 ----------
-- 動態刪除任何既有的 role CHECK（不論它原本叫什麼名字），確保不會殘留舊約束
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
      and pg_get_constraintdef(oid) ilike '%care%'
  loop
    execute 'alter table public.profiles drop constraint ' || quote_ident(c.conname);
  end loop;
end $$;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('care','social','nurse','admin','foreign_care'));

alter table public.profiles add column if not exists lang text not null default 'zh';
alter table public.profiles drop constraint if exists profiles_lang_check;
alter table public.profiles
  add constraint profiles_lang_check check (lang in ('zh','vi','id'));

-- ---------- quizzes：對象 / 語言 / 類別 ----------
alter table public.quizzes add column if not exists audience text not null default 'local';
alter table public.quizzes add column if not exists lang     text not null default 'zh';
alter table public.quizzes add column if not exists kind     text not null default 'skill';

alter table public.quizzes drop constraint if exists quizzes_audience_check;
alter table public.quizzes add constraint quizzes_audience_check check (audience in ('local','foreign'));

alter table public.quizzes drop constraint if exists quizzes_lang_check;
alter table public.quizzes add constraint quizzes_lang_check check (lang in ('zh','vi','id'));

alter table public.quizzes drop constraint if exists quizzes_kind_check;
alter table public.quizzes add constraint quizzes_kind_check check (kind in ('skill','language'));

-- 外籍測驗鎖定為外籍專屬；台籍測驗不得含 foreign_care
alter table public.quizzes drop constraint if exists quizzes_audience_roles_check;
alter table public.quizzes add constraint quizzes_audience_roles_check check (
  (audience = 'foreign' and roles = array['foreign_care']::text[])
  or
  (audience = 'local' and not ('foreign_care' = any(roles)))
);

-- 外籍測驗語言必為 vi/id；台籍測驗語言必為 zh
alter table public.quizzes drop constraint if exists quizzes_foreign_lang_check;
alter table public.quizzes add constraint quizzes_foreign_lang_check check (
  (audience = 'foreign' and lang in ('vi','id'))
  or
  (audience = 'local' and lang = 'zh')
);

-- 語言學習（學中文）僅限外籍測驗
alter table public.quizzes drop constraint if exists quizzes_kind_audience_check;
alter table public.quizzes add constraint quizzes_kind_audience_check check (
  kind = 'skill' or audience = 'foreign'
);

-- ---------- questions：題目語言 ----------
alter table public.questions add column if not exists lang text not null default 'zh';
alter table public.questions drop constraint if exists questions_lang_check;
alter table public.questions add constraint questions_lang_check check (lang in ('zh','vi','id'));

-- 註：
--  * 既有資料自動落在 local / zh / skill，全部符合上述約束，不受影響。
--  * 題目語言 vs 測驗語言的對應（vi 題只進 vi 測驗）由後台 UI 強制，
--    使用者未要求 DB 硬鎖，故此處不加跨表 trigger，保持單純與安全。
--  * questions_public / questions_flash 兩個 view 不需改：前端改以 quizzes
--    資料表的 lang/kind 欄位過濾清單，題目仍依 quiz_id 取得。

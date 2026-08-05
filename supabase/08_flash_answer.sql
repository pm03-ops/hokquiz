-- =====================================================================
-- 08: 字卡「完整句子答案」flash_answer
--   字卡背面顯示的是一句完整敘述的答案（比測驗的簡短選項 correct 更完整），
--   不再顯示干擾選項。questions_flash 改為 stem + correct(備援) + flash_answer + explain。
-- Run in Supabase → SQL Editor.
-- =====================================================================
alter table public.questions
  add column if not exists flash_answer text default '';

-- 需重建 view（欄位順序/名稱改變，create-or-replace 不允許）
drop view if exists public.questions_flash;
create view public.questions_flash as
  select q.id, q.quiz_id, q.stem, q.correct, q.flash_answer, q.explain
  from public.questions q
  join public.quizzes z on z.id = q.quiz_id
  where public.is_admin() or z.roles && array[public.auth_role()];

grant select on public.questions_flash to authenticated;

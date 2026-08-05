-- =====================================================================
-- Phase 1b: quiz vs flashcard split
--   * quiz_note  = SHORT feedback shown after answering in the QUIZ
--   * explain    = DETAILED explanation shown in the FLASHCARD area
--   * questions_flash = view exposing correct + explain for study
-- Run in Supabase → SQL Editor. Idempotent.
-- =====================================================================

alter table public.questions
  add column if not exists quiz_note text default '';

-- Flashcard study feed: shows the answer + deep explanation (open study),
-- filtered to the caller's role. Owned by postgres so it can read the
-- base table even though staff cannot select it directly.
create or replace view public.questions_flash as
  select q.id, q.quiz_id, q.stem, q.correct, q.explain
  from public.questions q
  join public.quizzes z on z.id = q.quiz_id
  where public.is_admin() or z.roles && array[public.auth_role()];

grant select on public.questions_flash to authenticated;

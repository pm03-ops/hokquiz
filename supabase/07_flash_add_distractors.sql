-- =====================================================================
-- Flashcards should show the actual answer choices (options), so the
-- flashcard view needs the distractors too.
-- NOTE: create-or-replace view cannot reorder existing columns, so
-- distractors is appended LAST (after explain).
-- Run in Supabase → SQL Editor.
-- =====================================================================
create or replace view public.questions_flash as
  select q.id, q.quiz_id, q.stem, q.correct, q.explain, q.distractors
  from public.questions q
  join public.quizzes z on z.id = q.quiz_id
  where public.is_admin() or z.roles && array[public.auth_role()];

grant select on public.questions_flash to authenticated;

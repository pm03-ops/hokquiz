-- =====================================================================
-- 10: 測驗即時回饋 —— questions_public 加入 correct 與 quiz_note，
--     讓前端可「立即判斷對錯」，不必等伺服器往返。
-- 註：課本／字卡本就公開所有答案，故此處不會多洩漏任何資訊；
--     成績仍由 quiz Edge Function 在後端權威記錄（背景送出），無法偽造。
-- 可 create-or-replace（僅在尾端追加欄位）。Run in Supabase → SQL Editor.
-- =====================================================================
create or replace view public.questions_public as
  select
    q.id,
    q.quiz_id,
    q.stem,
    ( select array_agg(o order by random())
      from unnest(q.distractors || array[q.correct]) as o ) as options,
    q.correct,
    q.quiz_note
  from public.questions q
  join public.quizzes z on z.id = q.quiz_id
  where public.is_admin() or z.roles && array[public.auth_role()];

grant select on public.questions_public to authenticated;

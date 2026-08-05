-- =====================================================================
-- 09: 字卡間隔複習（Anki 式）· 每個帳號分開記錄
--   level：熟練度（對應間隔天數）；due：下次到期日（day number）；
--   reps：連續按「熟悉」次數。按「熟悉」→ level 提升、間隔變長；
--   按「需複習」→ level 下降、當天再出現。
-- 僅本人可讀寫（RLS）。Run in Supabase → SQL Editor.
-- =====================================================================
create table if not exists public.card_reviews (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  level       integer not null default 0,
  due         integer not null default 0,   -- day number (floor(Date.now()/86400000))
  reps        integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.card_reviews enable row level security;

drop policy if exists card_reviews_own on public.card_reviews;
create policy card_reviews_own on public.card_reviews
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.card_reviews to authenticated;

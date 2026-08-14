-- =====================================================================
-- 18: 學中文字卡「間隔複習（SRS）」
--   在 vocab_progress 上加 level / due / reps 三欄（沿用測驗端 card_reviews 的模型）。
--   level：熟悉度等級（0..7，對應 db.js FLASH_INTERVALS）
--   due  ：下次到期「日序」= floor(now/86400000)，<= 今天即需複習
--   reps ：連續答對次數（統計用）
-- 可安全重跑。Run in Supabase → SQL Editor → paste → Run.
-- =====================================================================
alter table public.vocab_progress
  add column if not exists level smallint not null default 0,
  add column if not exists due   integer  not null default 0,
  add column if not exists reps  integer  not null default 0;

-- 既有的「已熟悉」卡：給一個合理的初始排程（今天到期，等於下次進複習會出現）
update public.vocab_progress
  set level = greatest(level, 1)
  where familiar = true and level = 0;

create index if not exists vocab_progress_due on public.vocab_progress(user_id, due);

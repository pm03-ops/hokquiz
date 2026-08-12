-- =====================================================================
-- 15: 語言學習「單字卡」（學中文）
--   以單字卡為中心：一張卡自動長出 看/聽/說/情境 練習；可標熟悉度。
--   * vocab_cards   ：單字卡本體（中文＋拼音＋母語意思＋例句＋主題＋級別）
--   * vocab_progress：每位員工對每張卡的熟悉/不熟悉標記
--   RLS：管理員全權；外籍照服可讀卡、只能讀寫自己的熟悉度。
-- 可安全重跑。Run in Supabase → SQL Editor → New query → paste → Run.
-- =====================================================================

-- ---------- 單字卡 ----------
create table if not exists public.vocab_cards (
  id             uuid primary key default gen_random_uuid(),
  lang           text not null check (lang in ('vi','id')),          -- 學員母語（例句/意思用此語言）
  theme          text not null default '',                            -- 主題：問候/身體/症狀/盥洗/餵食/安全/情緒/時間…
  level          text not null default 'basic' check (level in ('basic','advanced')),
  zh             text not null,                                       -- 中文詞（繁體，學習目標）
  pinyin         text not null default '',                            -- 漢語拼音（含聲調）
  meaning        text not null default '',                            -- 母語意思
  example_zh     text default '',                                     -- 例句（中文）
  example_pinyin text default '',                                     -- 例句拼音
  example_native text default '',                                     -- 例句母語翻譯
  created_at     timestamptz not null default now()
);
create index if not exists vocab_cards_lang_theme on public.vocab_cards(lang, theme, level);

-- ---------- 熟悉度（每位員工 × 每張卡） ----------
create table if not exists public.vocab_progress (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  card_id     uuid not null references public.vocab_cards(id) on delete cascade,
  familiar    boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_id, card_id)
);

-- ---------- RLS ----------
alter table public.vocab_cards    enable row level security;
alter table public.vocab_progress enable row level security;

-- 卡：管理員全權；外籍照服可讀（學習教材，非測驗答案）
drop policy if exists vocab_cards_admin_all on public.vocab_cards;
create policy vocab_cards_admin_all on public.vocab_cards
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists vocab_cards_read on public.vocab_cards;
create policy vocab_cards_read on public.vocab_cards
  for select using (public.is_admin() or public.auth_role() = 'foreign_care');

-- 熟悉度：只能讀寫自己的
drop policy if exists vocab_progress_own on public.vocab_progress;
create policy vocab_progress_own on public.vocab_progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.vocab_progress to authenticated;
grant select on public.vocab_cards to authenticated;

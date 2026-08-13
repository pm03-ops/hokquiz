-- =====================================================================
-- 16: 單字卡「兩句例句」——長輩說 + 照顧員回應（照護對話）
--   原 example_zh / example_pinyin / example_native → 視為「👴 長輩會說的」
--   新增 example_staff_* → 「🧑‍⚕️ 照顧員回應時會說的」
-- 可安全重跑。Run in Supabase → SQL Editor → New query → paste → Run.
-- =====================================================================
alter table public.vocab_cards add column if not exists example_staff_zh     text default '';
alter table public.vocab_cards add column if not exists example_staff_pinyin text default '';
alter table public.vocab_cards add column if not exists example_staff_native text default '';

-- =====================================================================
-- 19: 學中文「雙語系統性架構」保證
--   概念鍵 = 中文(zh)。同一個 zh 在每種語言最多一張卡；
--   共用欄位(拼音/主題/級別/中文例句)兩語言應一致，只有母語意思/例句不同。
--   本檔提供兩個結構性保證：
--     (1) (lang, zh) 唯一索引 → 同語言不會重覆同一個字
--     (2) vocab_sync_status 檢視 → 隨時查得出「缺對語言」或「共用欄位不一致」
-- 可安全重跑。Run in Supabase → SQL Editor → paste → Run.
-- =====================================================================

-- (1) 每種語言、每個中文詞只允許一張卡（若已有重覆，先略過並提示清理）
do $$
begin
  if exists (
    select 1 from public.vocab_cards group by lang, zh having count(*) > 1
  ) then
    raise notice '偵測到重覆的 (語言, 中文) 卡；已略過唯一索引。請先用後台「雙語同步檢查」清理後再重跑本段。';
  else
    create unique index if not exists vocab_cards_uniq_lang_zh
      on public.vocab_cards(lang, zh);
  end if;
end $$;

-- (2) 雙語同步狀態檢視（security_invoker：沿用 vocab_cards 的 RLS，僅管理員/外籍可讀）
create or replace view public.vocab_sync_status
  with (security_invoker = true) as
with by_zh as (
  select zh,
    count(*) filter (where lang = 'vi') as vi_n,
    count(*) filter (where lang = 'id') as id_n,
    count(distinct theme)  as themes,
    count(distinct level)  as levels,
    count(distinct pinyin) as pinyins,
    count(*) filter (where coalesce(meaning,'') = '') as missing_meaning
  from public.vocab_cards
  group by zh
)
select zh,
  (vi_n > 0)                 as has_vi,
  (id_n > 0)                 as has_id,
  (vi_n > 0 and id_n > 0)    as paired,
  (themes > 1 or levels > 1 or pinyins > 1) as mismatched,
  missing_meaning
from by_zh
order by paired, mismatched desc, zh;

# 學中文單字卡：雙語架構說明

## 目前模型（扁平表 + 概念鍵）

`vocab_cards` 每一列是「**某中文詞的某語言卡**」。同一個中文詞（如「頭痛」）在越南、印尼各一列。

**概念鍵 = `zh`（中文）**。同一個 `zh` 的兩列代表同一個概念，規則：

| 欄位 | 兩語言是否應一致 | 說明 |
|------|------------------|------|
| `zh` | ✅ 一致（就是鍵） | 中文詞／短句 |
| `pinyin` | ✅ 一致 | 拼音 |
| `theme` | ✅ 一致 | 主題分類（鎖定清單，見下） |
| `level` | ✅ 一致 | 基礎／進階 |
| `example_zh` / `example_pinyin` | ✅ 一致 | 長輩中文例句 |
| `example_staff_zh` / `example_staff_pinyin` | ✅ 一致 | 照顧員中文回話 |
| `meaning` | ❌ 各自 | 母語意思 |
| `example_native` / `example_staff_native` | ❌ 各自 | 母語翻譯 |

## 系統性保證（已內建）

1. **唯一索引 `(lang, zh)`**（`19_vocab_arch.sql`）→ 同一語言不可能出現兩張同字的卡。
2. **`vocab_sync_status` 檢視** → 隨時 `select * from vocab_sync_status where not paired or mismatched;` 就能查出「缺對語言」或「共用欄位不一致」。
3. **後台「🔁 雙語同步檢查」** → 一鍵補建缺少語言、一鍵對齊共用欄位。
4. **主題鎖定清單**（`VTHEMES`，11 類）→ 分類用下拉選、不自由打字，杜絕同義/錯字飄移。
5. **新增時「🇻🇳＋🇮🇩 一起產生」** → 從源頭就成對。

## 分類軸

只有兩軸，夠用且好維護：
- **主題（theme）**：問候／稱呼／身體部位／症狀／日常照護／盥洗／餵食／安全緊急／情緒安撫／時間數字／環境物品
- **級別（level）**：基礎 / 進階

因為分類綁在概念鍵上，**每個中文詞只需分類一次**，兩語言自動吃同一套。

## 未來若內容大量成長 → 正規化（選用）

把「概念」與「翻譯」拆開，結構上根除飄移：

```
vocab_concepts(id, zh UNIQUE, pinyin, theme, level,
               example_zh, example_pinyin, example_staff_zh, example_staff_pinyin, sort)
vocab_translations(concept_id, lang, meaning, example_native, example_staff_native,
                   PRIMARY KEY(concept_id, lang))
```

- 共用欄位只存一份（在 concept）→ 不可能不一致。
- 新增語言（例如未來加菲律賓語）只要在 `vocab_translations` 多一列。
- 遷移成本：現有扁平資料以 `zh` 分組即可轉入（因為 `zh` 已是概念鍵），再改 `db.js` 單字層 + 後台/前台讀寫。

**建議**：內容量不大時維持扁平模型（上面 5 道保證已足夠）；等單字量成長、或要支援第三種語言時再正規化。

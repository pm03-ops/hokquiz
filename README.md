# 照護學堂 · 線上測驗平台

養老院內部使用的線上測驗與學習平台，供照服員、社工、護理師等員工在職教育使用。
前端為純靜態網站（HTML / CSS / JS），部署於 **GitHub Pages**；資料與驗證由 **Supabase**（Postgres + Auth + Edge Functions）提供，多人、多裝置即時同步。

## 功能

- **前台（員工）** `index.html`：員工編號（**H＝台籍／T＝外籍** + 4 碼）+ 密碼登入、首次登入強制改密碼、線上測驗、間隔複習（SRS）、積分／連續天數／徽章／排行榜
  - **外籍雙軌**：外籍照服登入後選「技術學習／語言學習」
  - **學中文**：單字卡（中文＋拼音＋母語意思＋👴長輩／🧑‍⚕️照顧員對話例句）、主題單元、🎤口說跟讀（瀏覽器 Whisper）＋▶️回放、🔊朗讀、**📅今日複習（字卡 SRS）**
- **題庫後台** `admin.html`（限管理員）：測驗管理、Kahoot 式出題、AI 匯入教材出題、AI 生成干擾項／解說、產出外語（越南／印尼）題目
  - **帳號管理**：新增／**批次建立**／重設密碼／刪除、職務・單位篩選（見下）
  - **學中文管理**：AI 補完／匯入拆卡／**批次 AI 補完**／**雙語同步檢查**（以中文為概念鍵）
  - 角色分權（RLS）：測驗可設定開放對象，護理專屬題目照服員看不到
- **主管報表** `report.html`（限管理員）：完成度、分數趨勢、角色比較、題目難度、作答明細（含裝置代碼供異常比對）、外籍追蹤

## 帳號管理（後台 → 帳號）

員工用**員工編號 + 密碼**登入；編號規則 **H＝台籍、T＝外籍**（＋4 碼數字，例 `H0002` / `T0001`）。三個建立入口（前台自行註冊、後台單筆、後台批次）皆有一致的 **T/H 防呆**：T 開頭必須是「外籍照服」、選外籍必須用 T 開頭、H 卻設外籍需另一管理員授權。

### 批次建立帳號

後台 → 帳號 →「📋 批次建立多個帳號」開啟獨立設定畫面：

- **角色本批共用**（最上面選）；選「外籍照服」時，每列多一個**語言**下拉，**越南／印尼可混在同一批**。
- 每列只填 **員工編號＋單位（＋語言）**；姓名預設為員工編號。
- **共用預設密碼 `abcd1234`**，員工首次登入須改密碼。
- 填了任一欄自動長出新空白列；空白列不會建立。
- 建立時逐筆驗證格式／批內重覆／T-H 與外籍一致性。

### Excel / CSV 匯入格式

「📄 匯入 Excel/CSV」支援 `.xlsx` 與 `.csv`（另有「Excel 範本 / CSV 範本」可下載）。**三欄，順序固定**，第一列可放標題（會自動略過）：

| 欄位 | 必填 | 說明 |
|------|:----:|------|
| 員工編號 | ✅ | `H`/`T` + 4 碼；自動轉大寫 |
| 單位 | — | 可留空；填**單位代碼**（如 `C1`）或**單位名稱**都可 |
| 語言 | 外籍才需要 | `越南`／`印尼`（或 `vi`／`id`）；台籍免填 |

匯入後會帶進下方欄位供**核對再建立**，不直接寫入。角色仍在畫面上方選（整批共用）。
> 產生 `.xlsx` 用 `db.js` 的 `buildXlsx()`（純前端、未壓縮 zip + inlineStr，無外部套件）；讀取用 `parseTabularRows()`。

## 安全設計重點

- **測驗答案金鑰不外流**：作答時前端只拿到 `questions_public`（無正解）；評分在 Edge Function `quiz` 後端進行，成績由伺服器計算寫入，**無法偽造**。
- **字卡**為公開學習區（顯示正解與詳解），與測驗分離。
- **AI 金鑰**（Gemini）只存在 Supabase Edge Function 密鑰，前端與 repo 都看不到。
- **Row Level Security**：員工只讀寫自己的資料；管理員可管理全部。

## 檔案結構

| 檔案 | 說明 |
|------|------|
| `index.html` | 前台（員工作答／字卡／複習／排行） |
| `admin.html` | 題庫管理後台（限管理員） |
| `report.html` | 主管報表（限管理員） |
| `supabase-client.js` | Supabase 用戶端 + 驗證層（Auth） |
| `db.js` | 共用資料層（快取、Edge Function 呼叫、檔案解析、Excel 讀寫） |
| `styles.css` | 共用樣式 |
| `supabase/NN_*.sql` | 資料庫 schema、RLS、view、修補（**依編號順序執行**，目前到 `19`） |
| `supabase/17_vocab_seed_basic.sql` | 學中文「長輩常用字」種子（約 190 詞，越／印各一套） |
| `supabase/VOCAB_ARCH.md` | 學中文雙語架構說明（概念鍵、同步保證、未來正規化路徑） |
| `supabase/functions/ai-generate/` | Edge Function：AI 出題／干擾項／解說（Gemini 代理） |
| `supabase/functions/quiz/` | Edge Function：伺服器端評分（grade / finish） |
| `supabase/functions/admin-users/` | Edge Function：帳號建立／重設密碼／刪除 |

## 本機執行

```bash
python -m http.server 5500
```

然後瀏覽 http://localhost:5500/index.html

## 首次建置（Supabase）

1. 建立 Supabase 專案，取得 **Project URL** 與 **publishable 金鑰**，填入 `supabase-client.js`。
2. SQL Editor **依編號順序**執行 `supabase/01_schema.sql` … 到最新（目前 `19_*.sql`）。
3. Authentication → 關閉「Confirm email」。
4. 建立第一個管理員：Authentication → Users 新增 `h####@clinic.local`，再用 `02_bootstrap_admin.sql` 設為 admin。
5. 部署三個 Edge Function（Dashboard → Edge Functions → Open Editor → 貼上 `supabase/functions/*/index.ts` → Deploy）。
6. Edge Functions → Secrets 新增 `GEMINI_API_KEY`（Google AI Studio 免費金鑰）。（選用 `GEMINI_MODEL`，預設 `gemini-3.5-flash`。）

## 部署（GitHub Pages）

Settings → Pages → Source 選 `main` 分支 `/ (root)`，即可取得公開網址。
publishable 金鑰放前端是安全的（由 RLS 保護資料）；**service_role／Gemini 金鑰絕不放 repo**。

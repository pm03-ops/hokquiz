# 照護學堂 · 線上測驗平台

養老院內部使用的線上測驗與學習平台，供照服員、社工、護理師等員工在職教育使用。
前端為純靜態網站（HTML / CSS / JS），部署於 **GitHub Pages**；資料與驗證由 **Supabase**（Postgres + Auth + Edge Functions）提供，多人、多裝置即時同步。

## 功能

- **前台（員工）** `index.html`：員工編號（H####）+ 密碼登入、首次登入強制改密碼、字卡學習、線上測驗、間隔複習（SRS）、積分／連續天數／徽章／排行榜
- **題庫後台** `admin.html`（限管理員）：測驗管理、Kahoot 式出題、AI 匯入教材出題、AI 生成干擾項／解說、帳號管理（新增／重設密碼／刪除）
  - 角色分權（RLS）：測驗可設定開放對象，護理專屬題目照服員看不到
- **主管報表** `report.html`（限管理員）：完成度、分數趨勢、角色比較、題目難度、作答明細（含裝置代碼供異常比對）

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
| `db.js` | 共用資料層（快取、Edge Function 呼叫、檔案解析） |
| `styles.css` | 共用樣式 |
| `supabase/01–07_*.sql` | 資料庫 schema、RLS、view、修補（依序執行） |
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
2. SQL Editor 依序執行 `supabase/01_schema.sql` … `07_*.sql`。
3. Authentication → 關閉「Confirm email」。
4. 建立第一個管理員：Authentication → Users 新增 `h####@clinic.local`，再用 `02_bootstrap_admin.sql` 設為 admin。
5. 部署三個 Edge Function（Dashboard → Edge Functions → Open Editor → 貼上 `supabase/functions/*/index.ts` → Deploy）。
6. Edge Functions → Secrets 新增 `GEMINI_API_KEY`（Google AI Studio 免費金鑰）。（選用 `GEMINI_MODEL`，預設 `gemini-3.5-flash`。）

## 部署（GitHub Pages）

Settings → Pages → Source 選 `main` 分支 `/ (root)`，即可取得公開網址。
publishable 金鑰放前端是安全的（由 RLS 保護資料）；**service_role／Gemini 金鑰絕不放 repo**。

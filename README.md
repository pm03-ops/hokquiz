# 照護學堂 · 線上測驗平台

養老院內部使用的線上測驗與學習平台，供照服員、社工、護理師等員工在職教育使用。
純靜態網站（HTML / CSS / JS），無需後端即可執行，資料暫存於瀏覽器 localStorage。

## 功能

- **前台（員工）** `index.html`：登入、作答、學習模式（先學後測）、間隔複習（SRS）、積分／連續天數／徽章／排行榜
  - 練習模式：🎲 隨機綜合、🎯 自訂單元、🔧 加強弱點（常錯題）
- **題庫後台** `admin.html`：測驗管理、Kahoot 式出題、AI 匯入教材出題、帳號管理、AI 設定
  - 角色分權：測驗可設定開放對象，護理專屬題目照服員看不到
  - AI 自動生成干擾選項與教學解說（Google Gemini）
  - 支援上傳 Word(.docx) / Excel(.xlsx) / txt / csv 教材自動出題
- **主管報表** `report.html`：完成度、分數趨勢、角色比較、題目難度分析、各式明細表

## 檔案結構

| 檔案 | 說明 |
|------|------|
| `index.html` | 前台（員工作答） |
| `admin.html` | 題庫管理後台 |
| `report.html` | 主管報表 |
| `db.js` | 共用資料層（DB、AI 呼叫、檔案解析）— 三個頁面共用 |
| `styles.css` | 共用樣式 |

## 本機執行

因使用共用 `db.js`，建議用簡易伺服器開啟（而非直接雙擊）：

```bash
python -m http.server 5500
```

然後瀏覽 http://localhost:5500/index.html

## AI 設定（選用）

出題與教學解說可用 Google Gemini 生成：

1. 到 https://aistudio.google.com/apikey 申請免費 API 金鑰
2. 後台 → ⚙️ AI 設定 → 貼上金鑰 → 測試連線 → 儲存

> ⚠️ **金鑰只存在你的瀏覽器（localStorage），絕不會、也不應寫進程式碼或提交到本 repo。**
> 未設定金鑰時，系統會退回本機規則生成，功能仍可用。

## 部署（GitHub Pages）

Settings → Pages → Source 選 `main` 分支 `/ (root)`，即可取得公開網址。

## 後續規劃

- 改用 Supabase 作為共用資料庫（多人、多裝置同步）
- AI 金鑰改由 Supabase Edge Function 於後端保管（前端不接觸金鑰）

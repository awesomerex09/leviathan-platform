# TASK_PLAN.md：全自動每日即時行情串接 (Live Financial API Integration) 規劃案

## 1. 需求與系統架構 (Fully Automated Real-Time Architecture)

針對您的核心需求：**「希望網頁未來每天自動對齊最新當日走勢，無需人工在本地端更新數據或程式碼」**，答案是：**完全可以串接並實現全自動化！**

### 1.1 傳統靜態快照 vs 全自動即時 API 串接架構對比

| 功能項目 | 舊做法 (靜態快照) | 全自動即時 API 串接 (新架構) |
| :--- | :--- | :--- |
| **股價與大盤來源** | 本地 `prices.json` 靜態檔案 | **雲端 Financial API (Yahoo Finance / TWSE / Vercel API)** |
| **每日行情對齊** | 需要人工手動更新檔案與 Git Commit | **每天瀏覽器/雲端自動抓取最新當日收盤價** |
| **走勢圖端點** | 卡在最後一次 Commit 日期 | **自動推移至「今日 (Today)」，每日起伏與真實市場一致** |
| **Leviathan模型與各ETF** | 需人工重新上傳 | **每日依據最新個股成交價自動計算最新 NAV 與指標** |

---

## 2. 全自動串接技術方案設計 (Implementation Design)

```
                       [ 使用者開啟網頁 (Vercel) ]
                                   │
                                   ▼
                   [ 檢視當前日期與 prices.json ]
                                   │
                    缺少今日 (如 08/06, 08/07) 行情？
                                   │
                     ┌─────────────┴─────────────┐
                     ▼                           ▼
          【備援方案 A：前端 Live API】   【方案 B：Vercel Cron / Serverless】
          瀏覽器直接發送 Fetch Request    雲端每日定時任務 (18:00)
          至 Yahoo Finance API / TWSE     全自動更新 prices.json 庫
                     └─────────────┬─────────────┘
                                   │
                                   ▼
                  [ 自動寫入當日真實收盤價 (Real EOD Quote) ]
                                   │
                                   ▼
                  [ 全站 ETF / 大盤 / Leviathan 圖表動態繪製 ]
```

### 2.1 兩大自動化模組
1. **即時市場 API 串接模組 (`fetchLiveMarketPrices`)**：
   - 封裝 `fetchLiveMarketPrices(symbols)` 函式，串接金融市場 Quotes API（如 Yahoo Finance API 或台灣證券交易所 API）。
   - 當使用者造訪網頁時，若偵測到當前日期 > 股價庫最新日期，自動抓取 `0050.TW`、`TWD=X` 及主要成分股（`2330`, `NVDA`, `AAPL` 等）當日真實最新收盤價/即時價，直接注入動態運算鏈中。
2. **雲端自動化 Cron 任務 (Vercel Cron Job / GitHub Actions)**：
   - 建立每日收盤後的定時任務（每日 18:00 執行），自動拉取當日市場收盤數據，完全不需要您在本地端手動操作任何程式碼！

---

## 3. 批次執行任務清單 (Batch Execution Scope)

### 批次模組 A：前端即時金融 API 串接與轉接器 (`shared-preview-data.js` & `api/live-prices`)
- [x] **實作 `fetchLiveMarketPrices`**：
  - 支援抓取台美股標的（如 `0050.TW`, `2330.TW`, `NVDA`, `AAPL`, `TWD=X` 等）當日真實收盤價。
- [x] **整合至 `extendPricesAndEtfsToToday`**：
  - 當延伸日期至今日時，優先使用 Live API 獲取真實當日股價，注入 `prices` 字典中。
  - 徹底移除擬造等比例擬合公式 `currentPrice = lastNav * (pt.c / anchorBenchPt.c)`。

---

### 批次模組 B：Vercel / Node.js 自動更新服務 (`scripts/serve.js` & `api/cron`)
- [x] **建置 `/api/live-prices` Serverless 路由**：
  - 在 Vercel 環境及本地 Node.js 下處理 CORS 與 API 轉向，安全穩定地提供最新市場價格。
- [x] **設定 Vercel Cron / API 運作**：
  - [x] 加入 Vercel 雲端全站同步 `/api/settings.js` 端點

## Debug & Fixes (2026-08-06)

### 1. 基金圖表時間軸錯亂 (7/28 後出現 7/10 數據)
- **問題原因**：在 `shared-preview-data.js` 的 `extendPricesAndEtfsToToday` 函數中，我們從 `/api/live-prices` (Yahoo Finance) 抓取近 1 個月的歷史報價 (`range=1mo`)。當這些即時數據與原有的 `etfs.json` 數據合併時，如果某個舊日期（例如 7/10）在 `etfs.json` 中不存在，程式會將該筆資料 `.push()` 到陣列**最尾端**。由於合併後沒有對陣列重新按照日期排序，導致 7/28 之後接續了 7/10 的資料，前端圖表在繪製時就會出現「時光倒流」的折線。
- **解決方案**：在合併即時價格與填補缺失日期後，對 `benchSeries` 和 `etf.price_series` 執行一次日期排序：`etf.price_series.sort((a, b) => a.d.localeCompare(b.d))`。

### 2. Vercel 後台設定 (/api/settings) 定期重置
- **問題原因**：Vercel Serverless Functions (`api/settings.js`) 是無狀態且短暫存在的 (Ephemeral)。當我們使用 `let currentSettings = {...}` 將設定存在記憶體中時，只要該 API 一段時間沒被呼叫，Vercel 就會關閉該執行個體。下次有人再呼叫 API 時，Vercel 會啟動一個全新的執行個體，記憶體中的變數便會重置回預設值。先前加入的 `/tmp/settings.json` 雖然能在同一個容器（Warm Container）存活期間保留資料，但一旦流量歸零，Vercel 回收容器時，`/tmp` 空間同樣會被徹底清空（Cold Start），導致資料依然遺失。此外，若流量大導致多個容器並行運作，每個容器的 `/tmp` 也是獨立且互不相通的。
- **解決方案**：在 Serverless 架構下，**絕對無法單靠本機檔案或記憶體實現永久儲存**，必須依賴外部的持久化服務。
  
  **建議唯一根本解法**：在 Vercel 後台點擊 Storage，建立免費的 **Vercel KV (Redis)**，將設定值寫入 Redis。
  - **實作步驟**：
    1. 使用者在 Vercel 專案後台 Storage 頁籤，新增一個 `Vercel KV` 資料庫。
    2. Vercel 會自動將 `KV_REST_API_URL` 與 `KV_REST_API_TOKEN` 注入專案環境變數。
    3. 我們在 `api/settings.js` 裡透過 `fetch()` 將設定值 `POST` / `GET` 到這個 KV REST API。
  這樣不論 Serverless 容器如何重啟或平行擴展，所有連線都會抓到唯一且永久的設定值。

- [x] 前端與 Server 端無縫呼叫 `/api/live-prices` 每日自動刷新即時報價。

---

### 批次模組 C：全站自動化測試與 Vercel 部署
- [x] **測試無人工干預狀況下的每日對齊與無造假數據**：
  - 驗證開頁時，大盤走勢、各 ETF NAV 與 Leviathan 淨值使用真實市場數據更新。
- [x] **部署至 Vercel Production 準備完成**：
  - 程式碼已完成完全即時 API 串接與擬合公式拔除。

---

## 4. 人工驗收與測試切點 (Acceptance Checklist)

1. 開啟 `https://leviathan-platform.vercel.app/` 或任意 ETF 頁面：
   - 驗證頁面自動抓取並顯示當天最新日期。
   - 懸停走勢圖最右側，數值與當天市場真實價格 100% 對齊。
2. 確認未來無須在本地電腦執行任何 code 修改或檔案上傳，網站每日自動更新。

---

## 🚨 08/06 緊急修正：數據造假（完全擬合）問題分析與真實 API 串接計畫

### 💥 問題根因分析：為什麼後續幾天的數據看起來是「偽造的」？
用戶非常敏銳地發現了 07/29 ~ 08/05 的 ETF 走勢與大盤（`0050.TW`）**完全一模一樣（呈現完美的平行/擬合狀態）**。

問題出在 `shared-preview-data.js` 與 `scripts/serve.js` 中的 `extendPricesAndEtfsToToday` 函式。由於系統在 `etfs.json` 中缺乏 ETF（如 `00981D` 等）在 07/28 之後的**真實市場報價**，目前的程式碼使用了以下公式來「自動延伸」數據：
```javascript
// 目前的錯誤作法：強行讓 ETF 漲跌幅 = 0050.TW 的漲跌幅
currentPrice = lastNav * (pt.c / anchorBenchPt.c); 
```
這段邏輯**直接將 `0050.TW` 的每日變動比例，乘上 ETF 的最後淨值**。這導致所有基金在這段「延伸期間」內的績效，完全複製了大盤的波動，這也是為什麼走勢圖看起來被「偽造」與「強制對齊」的原因。

### 🛠️ 真正解決辦法：串接真實金融 API (Yahoo Finance / TWSE)
要達到**「以後都不需要本地端更新網頁數據，且確保數據是 100% 真實市場報價」**，我們不能使用比例擬合，而必須讓系統具備自己去網路上抓真實股價的能力。

**修正計畫 (Implementation Plan)**：
1. **建立 Vercel Serverless API (`api/live-prices.js`)**：
   - 透過 Node.js 在伺服器端呼叫 Yahoo Finance API (或其他免授權金融介面)，即時抓取 `0050.TW`、`0056.TW`、`00981D` (若為自選股則抓其底層成分股) 等標的之真實當日收盤價與歷史區間。
2. **重構 `extendPricesAndEtfsToToday`**：
   - 廢除 `currentPrice = lastNav * (pt.c / anchorBenchPt.c)` 這種擬合公式。
   - 改為非同步 (`async/await`) 向 `/api/live-prices` 請求。若取得真實股價，則繪製真實走勢；若 API 失敗，則保持現有最後一天，**寧可不畫也不造假**。
3. **動態更新 `prices` 與 `etfs` 記憶體狀態**：
   - 前端網頁載入時，發送請求獲取最新真實數據並合併進走勢圖，達成全自動且 100% 真實的每日更新。

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
- [ ] **實作 `fetchLiveMarketPrices`**：
  - 支援抓取台美股標的（如 `0050.TW`, `2330.TW`, `NVDA`, `AAPL`, `TWD=X` 等）當日真實收盤價。
- [ ] **整合至 `extendPricesAndEtfsToToday`**：
  - 當延伸日期至今日時，優先使用 Live API 獲取真實當日股價，注入 `prices` 字典中。

---

### 批次模組 B：Vercel / Node.js 自動更新服務 (`scripts/serve.js` & `api/cron`)
- [ ] **建置 `/api/live-prices` Serverless 路由**：
  - 在 Vercel 環境下處理 CORS 與 API 轉向，安全穩定地提供最新市場價格。
- [ ] **設定 Vercel Cron 定時任務**：
  - 設定每日台灣時間 18:00（美股/台股收盤後）自動刷新資料庫。

---

### 批次模組 C：全站自動化測試與 Vercel 部署
- [ ] **測試無人工干預狀況下的每日對齊**：
  - 驗證隔日開頁時，右上角日期、大盤走勢、各 ETF NAV 與 Leviathan 淨值全自動更新至最新一天。
- [ ] **部署至 Vercel Production**：
  - 上線後即可達成「永無需人工本地端維護」的全自動量化展示平台。

---

## 4. 人工驗收與測試切點 (Acceptance Checklist)

1. 開啟 `https://leviathan-platform.vercel.app/` 或任意 ETF 頁面：
   - 驗證頁面自動抓取並顯示當天最新日期。
   - 懸停走勢圖最右側，數值與當天市場真實價格 100% 對齊。
2. 確認未來無須在本地電腦執行任何 code 修改或檔案上傳，網站每日自動更新。

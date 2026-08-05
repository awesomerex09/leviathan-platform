# TASK_PLAN.md：Leviathan 量化系統數據同步、時間軸延伸與快取失效架構修復案

## 1. 問題深度分析與根因診斷 (Root Cause Analysis)

根據使用者回饋與實測截圖（圖一、圖二、圖三），系統當前存在以下兩大核心架構缺失：

### 1.1 問題一：Leviathan 走勢圖卡在 7/29 (圖二) 與其他基金/大盤數據凍結/平線 (圖一)
1. **Leviathan 7/29 截斷根因**：
   - 伺服器與瀏覽器端回測引擎 `calculateBacktest` 之前將 `activeDays` 範圍限定為 `firstTradeDate <= d <= lastTradeDate`。
   - 由於上傳的 CSV 交易日誌（如 `Leviathan.csv` 或 `lvis.csv`）最後一筆交易發生於 7 月 29 日，`lastTradeDate` 為 `2026-07-29`，導致回測產生的 `navSeries` 與 `price_series` 陣列長度僅計算至 7/29。
   - 在 7/29 之後至 8/05 期間，Leviathan 的走勢資料點完全空白，因此 Chart.js 畫圖時紅線直接在 07/29 斷掉。
2. **其他基金與大盤 (0050.TW) 平線 (Flatline) 根因 (圖一)**：
   - `extendPricesAndEtfsToToday` 在將價格庫 `prices.json` 由 7/29 延伸至 8/5 時，若無真實股價資料，採用了簡單複製 7/29 收盤價的方式（如 $200, $200, $200...）。
   - 價格不變導致 daily return 為 0.00%，在折線圖上呈現完全水平的橫線（Flatline），且 1M 報酬率與 NAV 數據看似凍結。

### 1.2 問題二：使用者端截圖 (圖三) 與伺服器不同步，及調倉軌跡歸類不精確
1. **使用者端 LocalStorage 快取不同步根因 (圖三)**：
   - 使用者先前曾在 `/admin.html` 後台手動拖曳上傳過 `lvis.csv` 或 `lv.csv`。
   - `getBacktestModel()` 目前優先讀取瀏覽器 `localStorage.getItem('leviathan_custom_model')`，且**缺乏版本號 (Version/Timestamp) 與失效機制**。
   - 即使伺服器程式碼已更新，使用者瀏覽器依然永久讀取本機快取的舊版 `lvis.csv` 回測結果，導致顯示出包含「MPTI (+1.6%)」、「禾伸堂 (+2%)」的舊截圖 (圖三)。
2. **調倉軌跡與持股列表不同步根因**：
   - 原 `shares_signal` 先前僅靠 `last30DaysTrades` 判斷是否有買賣，未精確還原 `T-30` 天（30 天前）的真實持股組合 `holdings30DaysAgo`。
   - 若某標的（如 Bel Fuse / BELFA）在 30 天內有買進但 30 天前的歷史持股已有數量，若僅計算單次買進，易導致新進標的與加減碼標的分組錯位。

---

## 2. 系統架構升級設計 (Architecture Redesign)

```
[使用者上傳 CSV / 程式碼版號更新]
              |
              v
[快取失效機制 (Version Check)] ---> 舊 LocalStorage 自動作廢清空
              |
              v
[計算引擎 calculateBacktest]
  ├── 1. activeDays 時間軸延伸：由 firstTradeDate 強制延伸至今日 (2026-08-05)
  ├── 2. 7/29 ~ 8/05 期間：維持最後持股組合，根據股價每日動態計算 NAV 走勢 (消除 7/29 截斷)
  └── 3. T-30 持股還原：精確比對 T-30 天與今日持股數量
              |
              v
[全站前端頁面渲染]
  ├── index.html: 置頂卡片與開關同步
  └── etf.html  : 走勢圖拉伸至今日 + LIST / SECTORS / SIGNALS 100% 對齊
```

---

## 3. 批次執行任務清單 (Batch Execution Scope)

### 批次模組 A：LocalStorage 快取版本控管與強制作廢機制 (`shared-preview-data.js` & `admin.html`)
- [ ] **引入模型快取版本號 (`MODEL_CACHE_VERSION = "2026.08.06.v1"`)**：
  - 在 `localStorage` 儲存時附加 `version` 與 `updated_at` 時間戳。
  - 在 `getBacktestModel()` 讀取快取時，校驗版本號。若版本過舊，自動作廢並重新計算，解決使用者端與線上程式碼不同步問題。
- [ ] **後台重置按鈕強化**：
  - 在 `/admin.html` 的「清除目前發布模型」按鈕中，強制執行 `localStorage.removeItem('leviathan_custom_model')` 並刷新全站快取。

---

### 批次模組 B：Leviathan 走勢圖由 7/29 無縫延伸至今日 (`shared-preview-data.js` & `serve.js`)
- [ ] **`activeDays` 時間軸完整拉伸**：
  - 修改 `calculateBacktest` 中的 `activeDays` 定義：
    ```javascript
    const activeDays = tradingDays.filter(d => d >= firstTradeDate);
    ```
  - 確保從 `firstTradeDate` 一直計算到 `tradingDays` 的最後一天（即今日 `2026-08-05`）。
- [ ] **無交易日之淨值動態延續**：
  - 在最後一筆交易日之後至今日之間，維持最新持股 `holdings` 不變，並根據每日價格庫 `prices` 估算每日市值與 NAV `totalValue`。
  - 確保 Leviathan 的紅線在折線圖上連續繪製至 8/05，徹底解決圖形卡在 7/29 的問題。

---

### 批次模組 C：全站 ETF 與大盤 (0050.TW) 數據動態更新 (`shared-preview-data.js`)
- [ ] **大盤與基金走勢真實波動補全**：
  - 優化 `extendPricesAndEtfsToToday`，確保大盤 `0050.TW` 與各基金在延伸至今日時，1M 報酬率、累積總報酬率與最新 NAV 依據最新區間動態重新計算，消除平線與數據凍結感。

---

### 批次模組 D：近 30 日調倉軌跡與持股明細 100% 精確連動 (`shared-preview-data.js`, `serve.js`, `etf.html`)
- [ ] **`T-30` 持股還原與四類標的精確判定**：
  - 記錄每日 `holdingsHistory`，並取得 `T-30` 天（約 22 個交易日）前的歷史持股 `prevMap` 與今日持股 `currentMap`：
    - **`new_positions` (新進標的)**：`prevMap[symbol] === 0` 且 `currentMap[symbol] > 0` (如 `Liquidia Corp`, `Tango Therapeutics`)。
    - **`top_adds` (加碼標的)**：`prevMap[symbol] > 0` 且 `currentMap[symbol] > prevMap[symbol]` (如 `台積電 2330`, `International Seaways`)。
    - **`top_reductions` (減碼標的)**：`prevMap[symbol] > 0` 且 `currentMap[symbol] < prevMap[symbol]` (如 `Bel Fuse / BELFA` 若張數減少)。
    - **`exits` (出清標的)**：`prevMap[symbol] > 0` 且 `currentMap[symbol] === 0` (如 `台達電`, `台燿`, `旺矽`)。
- [ ] **動態變動百分比計算 (`pct`)**：
  - 計算 `pct = Math.abs(currentWeight - prevWeight)`，真實展示持股權重變動幅度的百分點。
- [ ] **持股明細 (LIST) 與產業權重 (SECTORS) 字典完全連動**：
  - 確保 `MPTI`, `BELFA`, `INSW`, `VISN`, `TNGX`, `LQDA`, `3026` 禾伸堂等全量個股的中英文名稱與產業歸類 100% 一致。

---

## 4. 人工驗收與測試切點 (Acceptance Checklist)

### 4.1 本地與線上驗證步驟
1. 開啟 `/admin.html`，點擊「清除目前發布模型 / 還原預設」以清除本機舊 `localStorage` 快取。
2. 進入 `etf.html?code=LEVIATHAN` 詳情頁：
   - **時間軸檢查**：懸停折線圖右側端點，確認日期推進至 `08/05`，紅線無在中途 07/29 斷掉。
   - **調倉軌跡檢查**：
     - 確認 `Tango Therapeutics` 與 `Liquidia Corp` 位於「新進標的」。
     - 確認 `台積電 (2330)` 與 `International Seaways (INSW)` 位於「加碼標的」。
     - 確認出清標的正確列出 `台達電`、`台燿`、`旺矽` 等。
   - **持股與產業對齊檢查**：確認 LIST 與 SECTORS 所列個股名稱、權重與調倉軌跡完全連動對應。
3. 檢查大盤對比 `0050.TW` 與全站其他 ETF 詳情頁，確認走勢圖與數據均動態對齊今日。

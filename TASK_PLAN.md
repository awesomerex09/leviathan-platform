# TASK_PLAN.md：Leviathan 量化系統首頁置頂同步、時間對齊與持股/軌跡同步升級案

## 1. 專案概述與系統架構 (System Architecture & Data Flow)

本升級案旨在解決 **Leviathan 量化展示平台** 當前存在的四大核心架構設計缺失：
1. **首頁置頂卡片未同步**：當管理員在 `/admin.html` 後台上傳交易紀錄 CSV 或切換指標顯示開關時，更新僅同步至詳情頁（`/etf.html?code=LEVIATHAN`），而首頁（`/index.html`）頂部的「旗艦自研量化模型」卡片仍顯示靜態或舊快取數據，且未遵循指標開關設定。
2. **數據未對齊當前更新時間**：網頁右上角顯示的更新時間已推進至今日（`2026-08-05`），但 `prices.json` 與所有基金的歷史淨值走勢圖僅到 7 月底（`2026-07-29`）。系統需具備**自動對齊當前時間的向前填充（Forward-fill）機制**，使所有走勢圖與回測指標無縫對齊今日。
3. **持股明細與產業權重未即時同步**：自研模型 CSV 上傳後，持股明細與產業分佈（Sector View）未完全反應最新持股組合，且部分股票因缺乏產業對照字典而被歸類為預設「其他電子與製造」。
4. **近 30 日調倉軌跡未正確計算**：原 `shares_signal` 計算中存在硬編碼 `pct: 20` 的 Bug，且缺少完整的股票名稱字典，導致調倉軌跡標籤顯示為純代碼（如 `8299` 或 `BELFA`）且調倉幅度不準確。

---

## 2. 核心計算邏輯與虛擬碼 (Core Math & Pseudocode)

### 2.1 自動對齊當前更新時間：價格序列向前填充（Forward-Fill）
當 `prices.json` 的最新價格日期早於「網頁右上角顯示的今日時間」時，系統應自動補全中間缺失交易日（排除週六與週日），並以最後一天的收盤價進行向前填充。

### 2.2 近 30 日調倉軌跡 (`shares_signal`) 與產業分類計算
1. **調倉窗口**：以 CSV 交易紀錄最新日期（`lastDay`）往前推算 30 天作為調倉觀察窗口。
2. **軌跡分類**：
   - **Top Adds (加碼)**：窗口內買進數量大於賣出，且在 30 天前已有持股者。
   - **Top Reductions (減碼)**：窗口內賣出數量大於買進，且最新持股權重仍大於 0 者。
   - **New Positions (新進)**：窗口內首次買進且 30 天前無持股，最新持股權重 > 0 者。
   - **Exits (出清)**：窗口內賣出且最新持股權重歸零者。
3. **產業與名稱對照**：建立覆蓋台股與美股全量個股的名稱與產業分類字典（Semiconductors, Hardware, Biotech, Optoelectronics, Software, Financials 等）。

---

## 3. 批次執行任務清單 (Batch Execution Scope)

### 批次模組 A：首頁置頂卡片同步與快取防護 (`index.html`)

- [x] **DOM 結構升級**：在 `index.html` 中，為置頂旗艦模型卡片五個指標容器 `.flagship-stat-box` 新增明確的 ID：
  - 總報酬率容器：`id="flagship-box-total"`
  - 年化報酬率容器：`id="flagship-box-annual"`
  - 最高報酬率容器：`id="flagship-box-max"`
  - 索提諾比率容器：`id="flagship-box-sortino"`
  - 當 евре回撤容器：`id="flagship-box-mdd"`
- [x] **快取防護與強制重載**：
  - 在 `index.html` 的 `loadAndRender()` 函數最開頭，清空內存快取 `etfs = [];`，確保每次導回首頁（`pageshow` 事件）時均能重新解析並繪製最新狀態。
- [x] **置頂卡片指標隱顯控制**：
  - 於 `loadAndRender()` 中，非同步獲取開關設定 `const settings = await window.leviathanData.getSettings();`，依據 `settings` 狀態動態調整置頂卡片容器顯示樣式。

---

### 批次模組 B：資料時間自動對齊今日 (`shared-preview-data.js`)

- [x] **新增 `extendPricesAndEtfsToToday` 補全函數**：
  - 偵測 `prices['0050.TW']` 最新資料日期，補全缺失交易日直至當前系統日期，並對 `prices` 內所有標的進行 forward-fill 收盤價補全。
  - 對 `etfs` 陣列中所有基金的 `price_series`、`nav`、`close_price` 進行時間對齊與同比例補全。
- [x] **前端整合與調用**：
  - 在 `window.leviathanData.getBacktestModel(prices, etfs)` 入口處執行此補全函數，保證自研模型及所有基金走勢拉伸至今日。

---

### 批次模組 C：後台服務同步補全 (`serve.js`)

- [x] **移植 `extendPricesAndEtfsToToday` 至 Node.js 端**：
  - 將相同的價格補全與向前填充邏輯移植至 `scripts/serve.js`。
- [x] **後端 API 與回測同步**：
  - 確保在載入 `prices.json` 與 `etfs.json` 之後、進行回測計算之前，伺服器能自動執行補全對齊。

---

### 批次模組 D：持股明細、產業權重與近 30 日調倉軌跡同步校準 (`shared-preview-data.js`, `serve.js`, `etf.html`)

- [ ] **強化 CSV 解析容錯率 (Robust CSV Parsing)**：
  - 更新 `parseCSV`，支援 Dividend、空欄位（如手續費或成交價為空）等各式 CSV 交易明細，確保不漏掉任何日期與股數。
- [ ] **重構調倉軌跡演算法 (`shares_signal`)**：
  - 移除硬編碼 `pct: 20`，動態計算真正的調倉比例與最新權重。
  - 補全所有個股的中英文標準名稱，確保 `top_adds`, `top_reductions`, `new_positions`, `exits` 展示真實股票名稱。
- [ ] **擴充產業分類與股票名稱字典 (`getStockSector`, `getStockName`)**：
  - 在 `etf.html`、`shared-preview-data.js` 及 `serve.js` 中擴充美股 (`BELFA`, `HUT`, `INSW`, `VISN`, `TNGX`, `LQDA`, `AEHR`, `APLD`, `CIFR`, `WULF`, `POWL`) 與台股 (`8299`, `8996`, `6442`, `5289`, `6139`, `6223`, `6187`, `6274`, `3595`, `5536`) 的產業與名稱對照。
- [ ] **持股與產業視圖同步 (`renderHoldings`)**：
  - 確保上傳 CSV 後，持股明細表與 Sector View 產業權重分佈圖即時連動，準確展示各產業持股比例。

---

## 4. 人工驗收與測試切點 (Acceptance Checklist)

### 4.1 本地 Node.js 驗證步驟
1. 啟動伺服器：`node scripts/serve.js`。
2. 開啟首頁 `http://localhost:3000/`，確認右上角更新日期為今日（例如 `2026-08-05`）。
3. 進入詳情頁 `http://localhost:3000/etf.html?code=LEVIATHAN`，確認走勢圖右側端點拉伸至今日。
4. 檢查持股明細與產業權重（Sectors View），確認各股票有名稱且產業分佈精確。
5. 檢查「近 30 日調倉軌跡」，確認標籤顯示中文/英文股票名稱及動態計算的調倉百分比。
6. 進入後台 `http://localhost:3000/admin.html` 上傳新 CSV，確認首頁置頂與詳情頁各模組完美同步。

### 4.2 Vercel 線上託管驗證步驟
1. 執行雲端發布：
   ```cmd
   cmd /c "set NODE_OPTIONS=--dns-result-order=ipv4first && npx vercel --prod --yes"
   ```
2. 造訪正式網站 `https://leviathan-platform.vercel.app/`。
3. 於 `/admin.html` 上傳測試 CSV，確認線上靜態模式下持股、產業與調倉軌跡全數正確同步。

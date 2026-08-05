# TASK_PLAN.md：Leviathan 量化系統首頁置頂同步與時間對齊升級案

## 1. 專案概述與系統架構 (System Architecture & Data Flow)

本升級案旨在解決 **Leviathan 量化展示平台** 當前存在的兩大核心架構設計缺失：
1. **首頁置頂卡片未同步**：當管理員在 `/admin.html` 後台上傳交易紀錄 CSV 或切換指標顯示開關時，更新僅同步至詳情頁（`/etf.html?code=LEVIATHAN`），而首頁（`/index.html`）頂部的「旗艦自研量化模型」卡片仍顯示靜態或舊快取數據，且未遵循指標開關設定。
2. **數據未對齊當前更新時間**：網頁右上角顯示的更新時間已推進至今日（`2026-08-05`），但 `prices.json` 與所有基金的歷史淨值走勢圖僅到 7 月底（`2026-07-29`）。系統需具備**自動對齊當前時間的向前填充（Forward-fill）機制**，使所有走勢圖與回測指標無縫對齊今日。

### 1.1 模組互動與資料傳遞架構

```
[管理員上傳 CSV / 變更開關] -> admin.html (後台)
                               |
                               +---> (API 寫入 / LocalStorage 快取)
                               |
                               v
                       [首頁/詳情頁重新載入]
                               |
       +-----------------------+-----------------------+
       |                                               |
       v                                               v
  index.html (首頁)                               etf.html (詳情頁)
  * pageshow 清除快取強制更新                      * 讀取 localStorage / API
  * 載入最新自訂模型與開關設定                      * 依開關隱顯 10 宮格
  * 隱顯旗艦置頂卡片對應欄位                        * 顯示 10 大指標與走勢圖
  * 呼叫自動向前填充對齊今日                        * 呼叫自動向前填充對齊今日
```

---

## 2. 核心計算邏輯與虛擬碼 (Core Math & Pseudocode)

### 2.1 自動對齊當前更新時間：價格序列向前填充（Forward-Fill）
當 `prices.json` 的最新價格日期早於「網頁右上角顯示的今日時間」時，系統應自動補全中間缺失交易日（排除週六與週日），並以最後一天的收盤價進行向前填充。

#### 價格與 ETF 序列補全虛擬碼 (Pseudocode)：
```javascript
// FUNCTION: extendPricesAndEtfsToToday(prices, etfs)
// 目標：將 prices 股價與 etfs 淨值走勢補全至今天（例如 2026-08-05）

function extendPricesAndEtfsToToday(prices, etfs) {
  const today = new Date();
  const todayStr = formatYYYYMMDD(today); // 格式化為 "20260805"
  
  // 以 0050.TW 做為交易日基準
  const benchSeries = prices['0050.TW'];
  if (!benchSeries || !benchSeries.length) return;
  
  const lastBenchDateStr = benchSeries[benchSeries.length - 1].d; // "20260729"
  if (lastBenchDateStr >= todayStr) return; // 已是對最新狀態，無須補全
  
  // 1. 產生缺失的交易日 (排除週六與週日)
  const missingDates = [];
  let currentDate = parseDateStr(lastBenchDateStr); // 解析為 Date 物件
  currentDate.setDate(currentDate.getDate() + 1);
  
  while (formatYYYYMMDD(currentDate) <= todayStr) {
    const dayOfWeek = currentDate.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0:週日, 6:週六
      missingDates.push(formatYYYYMMDD(currentDate));
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  if (!missingDates.length) return;
  
  // 2. 補全 prices 中所有標的的價格序列
  for (const [symbol, series] of Object.entries(prices)) {
    if (!series || !series.length) continue;
    let lastPrice = series[series.length - 1].c;
    for (const newDate of missingDates) {
      series.push({ d: newDate, c: lastPrice });
    }
  }
  
  // 3. 補全 etfs 中所有基金 of price_series 序列
  for (const etf of etfs) {
    if (!etf.price_series || !etf.price_series.length) continue;
    
    const ticker = convertSymbol(etf.code);
    const tickerPrices = prices[ticker];
    
    // 如果 prices 中有該標的，使用 prices 補全；否則用最後淨值向前填平
    const lastPoint = etf.price_series[etf.price_series.length - 1];
    let lastNav = lastPoint.c;
    
    const etfLastDate = lastPoint.d;
    for (const newDate of missingDates) {
      if (newDate <= etfLastDate) continue;
      
      let currentPrice = lastNav;
      if (tickerPrices) {
        const pPoint = tickerPrices.find(p => p.d === newDate);
        if (pPoint) {
          // 依據上市日價格變動比率來補全淨值走勢
          const prevPricePoint = tickerPrices.find(p => p.d === etfLastDate) || tickerPrices[0];
          if (prevPricePoint && prevPricePoint.c > 0) {
            currentPrice = lastNav * (pPoint.c / prevPricePoint.c);
          }
        }
      }
      etf.price_series.push({ d: newDate, c: parseFloat(currentPrice.toFixed(2)) });
    }
    // 更新最新淨值與收盤價
    etf.nav = etf.price_series[etf.price_series.length - 1].c;
    etf.close_price = etf.nav;
  }
}
```

---

## 3. 批次執行任務清單 (Batch Execution Scope)

### 批次模組 A：首頁置頂卡片同步與快取防護 (`index.html`)

- [ ] **DOM 結構升級**：在 `index.html` 中，為置頂旗艦模型卡片五個指標容器 `.flagship-stat-box` 新增明確的 ID：
  - 總報酬率容器：`id="flagship-box-total"`
  - 年化報酬率容器：`id="flagship-box-annual"`
  - 最高報酬率容器：`id="flagship-box-max"`
  - 索提諾比率容器：`id="flagship-box-sortino"`
  - 當前回撤容器：`id="flagship-box-mdd"` (對齊 `current_drawdown` 開關狀態)
- [ ] **快取防護與強制重載**：
  - 在 `index.html` 的 `loadAndRender()` 函數最開頭，加入 `etfs = [];` 以清空內存快取，確保每次導回首頁（`pageshow` 事件）時均能重新解析並繪製最新狀態。
- [ ] **置頂卡片指標隱顯控制**：
  - 於 `loadAndRender()` 中，非同步獲取開關設定 `const settings = await window.leviathanData.getSettings();`。
  - 依據 `settings` 狀態，動態調整上述 5 個置頂卡片容器的顯示樣式（`style.display = show ? '' : 'none'`）。

---

### 批次模組 B：資料時間自動對齊今日 (`shared-preview-data.js`)

- [ ] **新增 `extendPricesAndEtfsToToday` 補全函數**：
  - 實作前述虛擬碼，偵測 `prices['0050.TW']` 最新資料日期，補全缺失交易日直至當前系統日期，並對 `prices` 內所有標的進行 forward-fill 收盤價補全。
  - 對 `etfs` 陣列中所有基金的 `price_series`、`nav`、`close_price` 進行時間對齊與同比例補全。
- [ ] **前端整合與調用**：
  - 在 `window.leviathanData.getBacktestModel(prices, etfs)` 的入口處，先執行此補全函數，保證自研模型的即時回測能在對齊今日（`2026-08-05`）的交易日序列上執行。
  - 同時在 `index.html` 與 `etf.html` 載入 `prices.json` 與 `etfs.json` 後，立即使其調用此補全函數，使所有基金的圖表、走勢能自動拉伸至今日。

---

### 批次模組 C：後台服務同步補全 (`serve.js`)

- [ ] **移植 `extendPricesAndEtfsToToday` 至 Node.js 端**：
  - 將相同的價格補全與向前填充邏輯移植至 `scripts/serve.js`。
- [ ] **後端 API 與回測同步**：
  - 確保在載入 `prices.json` 與 `etfs.json` 之後、進行回測計算之前，伺服器能自動執行補全對齊。
  - 使 `/api/backtest`、`/api/upload`、`/api/clear` 輸出的走勢序列與數值完美對齊今日，維持前後端數據與圖表的一致性。

---

## 4. 人工驗收與測試切點 (Acceptance Checklist)

### 4.1 本地 Node.js 驗證步驟
1. 啟動伺服器：`node scripts/serve.js`。
2. 開啟首頁 `http://localhost:3000/`，確認右上角更新日期為今日（例如 `2026-08-05`）。
3. 進入詳情頁 `http://localhost:3000/etf.html?code=LEVIATHAN`，確認走勢圖右側端點已拉伸至今日，而非停在 7 月底。
4. 進入後台 `http://localhost:3000/admin.html`：
   - 取消勾選「當前回撤」與「索提諾比率」，並上傳最新的交易明細 CSV。
   - 返回首頁 `http://localhost:3000/`，確認置頂自研模型卡片中的「當前回撤」與「索提諾比率」數據框已**同步隱藏**。
   - 點擊置頂卡片進入詳情頁，確認對應的指標也已隱藏，且走勢與持股完整顯示。

### 4.2 Vercel 線上託管驗證步驟
1. 執行雲端發布：
   ```cmd
   cmd /c "set NODE_OPTIONS=--dns-result-order=ipv4first && npx vercel --prod --yes"
   ```
2. 關閉本地伺服器，造訪正式網站 `https://leviathan-platform.vercel.app/`。
3. 於 `/admin.html` 進行指標勾選測試與 CSV 上傳。
4. 確認首頁置頂欄位與詳情頁指標顯示同步變化，且數據截止日期完美對齊右上角今日時間。

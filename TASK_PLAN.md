# TASK_PLAN.md：Leviathan 量化系統全站數據對齊、調倉軌跡校準與時間延伸修復案

## 1. 專案概述與系統架構 (System Architecture & Data Flow)

本升級案旨在徹底修復 **Leviathan 量化展示平台** 當前存在的五大關鍵數據與邏輯異常：

1. **Leviathan 圖形與淨值截斷至 7/29**：
   - 原回測引擎 `calculateBacktest` 之 `activeDays` 僅執行至交易紀錄 CSV 的最後交易日（7 月 29 日），導致 Leviathan 的走勢圖與淨值在 7/29 停滯，無法延伸至今日（`2026-08-05`）。
   - **解法**：`activeDays` 必須從首個交易日一直延伸至價格庫最新日（`2026-08-05`）。在最後交易日之後，模型持續持有最新持股組合，淨值每日依個股股價收盤動態更新至今日。

2. **近 30 日調倉軌跡 (`shares_signal`) 標的歸類錯誤**：
   - 原歸類邏輯未比對 30 天前的持股狀態，僅判斷 30 天內是否有賣出，導致長期持有的股票（如台積電 2330）因近期有股利或買進而被錯誤歸類為「新進標的 (`new_positions`)」，而真實的新建倉標的反被錯歸為「加碼」。
   - **解法**：重構 `shares_signal` 演算法，精確重構 `T-30` 天前與 `T` 天（今日）的持股組合，以持股數量與權重變化進行嚴格比對：
     - **新進標的 (`new_positions`)**：`T-30` 股數 = 0 且 `T` 股數 > 0。
     - **加碼標的 (`top_adds`)**：`T-30` 股數 > 0 且 `T` 股數 > `T-30` 股數。
     - **減碼標的 (`top_reductions`)**：`T` 股數 > 0 且 `T` 股數 < `T-30` 股數。
     - **出清標的 (`exits`)**：`T-30` 股數 > 0 且 `T` 股數 = 0。

3. **股利交易 (Dividend) 污染持股張數 Bug**：
   - `parseCSV` 解析 `Side: Dividend` 時，將現金股利金額錯當作股票張數/股數累加至 `holdings`，導致發放股利的股票張數與持股比例嚴重失真。
   - **解法**：`Dividend` 交易僅增加現金 `cash += div`，嚴禁修改持股張數 `holdings[symbol]`。

4. **持股明細 (Holdings)、產業權重 (Sectors) 與調倉軌跡不同步**：
   - 股票代號格式不統一（如 `TWSE:2330` vs `2330` vs `2330.TW`），導致列表、產業視圖與軌跡無法關聯。
   - **解法**：全站統一採用 `cleanSymbolCode` 正規化代號，並全面升級 `getStockName` 與 `getStockSector` 字典。

5. **全站其他 ETF 與 Benchmark 數據與走勢更新**：
   - 其它 ETF 與大盤對比在向前填充後未重新計算 1M 報酬率與 NAV，導致數據看似凍結。
   - **解法**：在 `extendPricesAndEtfsToToday` 中，一併動態更新所有 ETF 之 `nav`, `close_price`, `1M 報酬率` 與 `Total 報酬率`。

---

## 2. 核心計算邏輯與虛擬碼 (Core Math & Pseudocode)

### 2.1 嚴格 30 日調倉軌跡判定演算法 (Pseudocode)

```javascript
function calculateTradeSignals(holdingsHistory, activeDays, finalHoldings, stockNameLookup) {
  const latestIdx = activeDays.length - 1;
  const latestRecord = holdingsHistory[latestIdx]; // T 天 (今日) 持股
  
  // 尋找 30 天前的歷史索引 (約 22 個交易日)
  const prevIdx = Math.max(0, latestIdx - 22);
  const prevRecord = holdingsHistory[prevIdx]; // T-30 天持股
  
  const currentMap = latestRecord.holdings; // { "TWSE:2330": 1000, ... }
  const prevMap = prevRecord.holdings;       // { "TWSE:2330": 1000, ... }
  
  const new_positions = [];
  const top_adds = [];
  const top_reductions = [];
  const exits = [];
  
  // 1. 檢驗當前持股 (Current Holdings)
  for (const [symbol, curShares] of Object.entries(currentMap)) {
    const code = cleanSymbolCode(symbol);
    const name = stockNameLookup(code);
    const curWeight = finalHoldings.find(h => h.code === code)?.weight || 0;
    const prevShares = prevMap[symbol] || 0;
    const prevWeight = getHistoricalWeight(prevRecord, symbol);
    
    if (prevShares === 0) {
      // 30 天前持股為 0 -> 新進標的
      new_positions.push({ code, name, weight: curWeight, shares: curShares });
    } else if (curShares > prevShares) {
      // 30 天前已有持股且加碼
      const weightDelta = parseFloat((curWeight - prevWeight).toFixed(2));
      top_adds.push({ code, name, pct: Math.abs(weightDelta) || 1.0, weight: curWeight });
    } else if (curShares < prevShares) {
      // 30 天前已有持股且減碼
      const weightDelta = parseFloat((prevWeight - curWeight).toFixed(2));
      top_reductions.push({ code, name, pct: Math.abs(weightDelta) || 1.0, weight: curWeight });
    }
  }
  
  // 2. 檢驗 30 天前有持股但目前歸零者 -> 出清標的
  for (const [symbol, prevShares] of Object.entries(prevMap)) {
    if (!currentMap[symbol] || currentMap[symbol] <= 0) {
      const code = cleanSymbolCode(symbol);
      const name = stockNameLookup(code);
      exits.push({ code, name });
    }
  }
  
  return { new_positions, top_adds, top_reductions, exits };
}
```

---

## 3. 批次執行任務清單 (Batch Execution Scope)

### 批次模組 A：Leviathan 回測時間軸拉伸與股利計算修復 (`shared-preview-data.js` & `serve.js`)
- [ ] **時間軸拉伸至今日**：
  - 修改 `calculateBacktest` 中 `activeDays` 範圍，使其由 `firstTradeDate` 持續延伸至 `tradingDays[tradingDays.length - 1]`（即今日 `2026-08-05`）。
  - 在最後交易日之後，持續計算持股組合的每日市值與 NAV 變化，確保 Leviathan 走勢圖右側端點拉伸至今日。
- [ ] **修復 Dividend 股利計算**：
  - 在交易迴圈中，當 `trade.side === 'Dividend'` 時，僅執行 `cash += div`，嚴禁修改 `holdings[trade.symbol]` 數量。

---

### 批次模組 B：近 30 日調倉軌跡重構 (`shared-preview-data.js` & `serve.js`)
- [ ] **實作 `T-30` 持股比對演算法**：
  - 根據 `holdingsHistory` 紀錄，對比 `T-30` 與 `T`（今日）的持股狀態。
  - 精確劃分 `new_positions`（新進）、`top_adds`（加碼）、`top_reductions`（減碼）、`exits`（出清）。
- [ ] **動態計算權重變動 (`pct`)**：
  - 將加減碼標的之 `pct` 改為 `T` 與 `T-30` 的權重變化量，徹底移除硬編碼。
- [ ] **股票代號與名稱正規化**：
  - 使用 `cleanSymbolCode` 統一清洗 `TWSE:`, `NASDAQ:`, `.TW`, `.TWO`, ` US` 等字串，確保名稱查詢 100% 匹配。

---

### 批次模組 C：持股列表與產業權重 100% 對齊 (`etf.html` & `shared-preview-data.js`)
- [ ] **`getFullHoldings` 統一化**：
  - 確保 `LEVIATHAN` 與全站所有 ETF 的 `holdings` 均通過相同的 `cleanSymbolCode` 與 `getStockName` / `getStockSector` 處理。
- [ ] **產業字典全面升級 (`getStockSector`)**：
  - 補全全站台美股標的之產業對照（半導體、電腦零組件、光電通訊、生化醫療、軟體雲端、金融保險、航運能源等），消除「其他電子與製造」預設分類。
- [ ] **全站 ETF 1M & Total 報酬率拉伸對齊**：
  - 在 `extendPricesAndEtfsToToday` 中，同步更新全站 ETF 之 `m1_return` 與 `nav`，使其走勢與數據同步拉伸至今日。

---

## 4. 人工驗收與測試切點 (Acceptance Checklist)

### 4.1 本地 Node.js 驗證步驟
1. 啟動伺服器：`node scripts/serve.js`。
2. 進入 `http://localhost:3000/etf.html?code=LEVIATHAN`：
   - 驗證走勢圖右側端點拉伸至今日（`2026-08-05`）。
   - 驗證「近 30 日調倉軌跡」中，台積電已離開「新進標的」，加減碼與新進標的完全符合 30 天前的持股比對。
   - 驗證「持股明細 (List View)」與「產業權重 (Sectors View)」所展示的標的與比例 100% 一致。
3. 檢查全站其他 ETF 詳情頁，確認圖表與指標均延伸至今日且無離奇數據停滯。

### 4.2 Vercel 線上託管驗證步驟
1. 執行雲端發布：
   ```cmd
   cmd /c "set NODE_OPTIONS=--dns-result-order=ipv4first && npx vercel --prod --yes"
   ```
2. 造訪 `https://leviathan-platform.vercel.app/etf?code=LEVIATHAN`，驗證調倉軌跡、持股明細、產業權重與走勢圖對齊今日。

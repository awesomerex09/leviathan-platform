這個功能非常關鍵，它能讓整個專案從「靜態顯示」升級為「強大且可互動的量化模型測試/展示平台」！

簡單來說，你需要一個「交易明細解析引擎 (Trade Log Parser & Analytics Engine)」。你只要拖入一份 CSV 格式的歷史交易紀錄（例如：`Leviathan.csv` 格式），系統就會在前端直接進行即時回測計算，自動幫你算出：

1. **每日淨值 (NAV) 與價格走勢 (Price Series)**：自動生成 Sparkline 迷你走勢圖與歷史折線圖。
2. **預估 AUM / 總市值**：基於最新持股與價格。
3. **近月/近季/成立以來漲跌幅**。
4. **即時持股明細 (Holdings) 與 前三大持股 (Top 3)**：根據未平倉部位自動統計當前權重。
5. **歷史調倉軌跡與加減碼訊號 (Shares Signal)**：自動計算近 30 天的加碼、減碼、新進與出清標的。
6. **對比大盤 (0050)**：提供圖表對比自研模型與 0050 大盤績效。

---

# 專案執行方針：ETFedge 全面復刻與自研量化模型整合平台 (ETFedge Cloning & Quant Interactive Platform)

## 專案願景與核心目標

1. **極致復刻前端體驗**：還原 ETFedge (etfedge.xyz) 的高密度卡片牆 (Market Map)、黑綠科技風格 UI/UX、Sparkline 走勢圖與篩選排序邏輯。
2. **零成本 / 極低成本資料架構**：建立自動化更新機制，每日自動同步台灣證交所 (TWSE) 與櫃買中心 (TPEx) Open API 資料，託管於免費 Serverless 平台。
3. **動態模型交易明細解析引擎 (Trade Log Parser Engine)**：提供前端上傳介面，只需上傳固定格式的自研模型「歷史交易明細（例如 `Leviathan.csv`）」，系統將在前端自動還原並計算出與市場基金一模一樣的淨值走勢、持股權重、近月績效及加減碼軌跡，且模型底層邏輯與參數完全保密。
4. **嵌入自研量化模型**：將解析後的自研策略包裝為虛擬基金（代號 `LEVIATHAN`），完全融入系統卡片與圖表，與真實市場主動 ETF 同場對比，並可與 `0050` 大盤進行績效對比。

---

## 數據規格說明 (Data Schema Specification)

### 1. 使用者上傳之交易明細標準格式 (User Input: `Leviathan.csv`)

本平台支援上傳包含買、賣、配息等動作的交易明細，格式如下：

```csv
Symbol,Side,Qty,Fill Price,Commission,Closing Time
TWSE:2449,Sell,60,226.5,0,2026-07-29 05:24:00
TPEX:5289,Sell,19,1170,0,2026-07-29 05:24:00
TWSE:2330,Dividend,330.00072402,,,2026-01-08 00:00:00
```

* **Symbol**：標的代號，台灣上市股票格式為 `TWSE:代號`，上櫃股票為 `TPEX:代號`，美股為 `NASDAQ:代號` 或 `NYSE:代號`。
* **Side**：交易類別，支援 `Buy` (買入)、`Sell` (賣出)、`Dividend` (配息)。
* **Qty**：交易數量。配息時，此欄位代表配息金額 (NTD / USD)。
* **Fill Price**：成交單價（配息時為空）。
* **Commission**：手續費 / 交易成本（配息時為空）。
* **Closing Time**：交易時間，格式為 `YYYY-MM-DD HH:mm:ss`。

### 2. 系統自動轉譯與計算後之基金標準 Schema (System Generated Object)

```json
{
  "code": "LEVIATHAN",
  "name": "自研量化模型 (Leviathan)",
  "issuer": "Custom Quant Model",
  "is_custom_quant": true,
  "total_av_yi": 0.12,
  "listing_date": "20251106",
  "close_price": 10.0,
  "nav": 10.0,
  "monthly_return": "+18.5%",
  "price_series": [
    { "d": "20260720", "c": 10.0 },
    { "d": "20260728", "c": 12.8 }
  ],
  "top3": [
    { "code": "2330", "name": "台積電", "weight": 25.4 },
    { "code": "2454", "name": "聯發科", "weight": 18.2 }
  ],
  "shares_signal": {
    "top_adds": [ { "code": "2330", "name": "台積電", "delta": 500, "pct": 50.0 } ],
    "top_reductions": [],
    "new_positions": [],
    "exits": []
  }
}

\* 建立高密度 ETF Card 組件。

\* 實作 SVG / Recharts 迷你 Sparkline 走勢圖。

\* 增加自訂量化模型標籤（`is\_custom\_quant` 特殊螢光邊框與標籤區隔）。







\### 第二階段：交易明細解析引擎與上傳模組 (Trade Log Parser \& Quant Modeler)



\* \[ ] \*\*上傳互動模組 (Upload Modal / Drag \& Drop Zone)\*\*：

\* 在 Toolbar 增加 `\[+ 載入自研模型交易明細]` 按鈕。

\* 支援拖曳上傳 CSV / JSON 交易紀錄檔。





\* \[ ] \*\*前端即時計算核心 (Client-side Quant Engine)\*\*：

\* \*\*持股池統計 (Position Tracker)\*\*：讀取買賣紀錄，推算每日持股庫存與現金餘額。

\* \*\*每日 NAV 繪製器 (NAV Generator)\*\*：結合每日收盤價計算模型每日資產淨值波形（Price Series）。

\* \*\*調倉訊號計算器 (Signal Calculator)\*\*：對比近 30 天倉位變化，自動產出加碼/減碼/新進/出清清單。





\* \[ ] \*\*本地持久化 (LocalStorage Cache)\*\*：上傳解析後的模型自動暫存於瀏覽器，下次開啟網頁無需重新上傳。



\### 第三階段：零成本資料流與自動化腳本 (Data Pipeline \& Automation)



\* \[ ] \*\*建立 Python 爬蟲與整合腳本 (`scripts/update\_data.py`)\*\*：

\* 從 TWSE / TPEx 公開 API 抓取真實主動 ETF 數據並清洗儲存為 `public/data/etfs.json`。





\* \[ ] \*\*設定 GitHub Actions (`.github/workflows/daily\_update.yml`)\*\*：

\* 設定 Cron Schedule（工作日台北時間 14:30 執行），自動Commit 與部署。







\### 第四階段：量化模型深度對比 (Quant Model Comparison)



\* \[ ] \*\*對比詳情頁 Modal/Page\*\*：

\* 呈現持股明細、產業佔比圓餅圖。

\* 支援自研模型與市場標的（如 `00981A`）之 Overlaid 走勢對比圖、夏普值與最大回撤 (MDD) 表格對比。







\---



\## Antigravity IDE 指令與開發規範 (IDE Agent Prompts)



1\. \*\*代碼風格 (Code Style)\*\*：

\* 前端一律使用 TypeScript + React 函式型組件 (Functional Components)。

\* UI 樣式優先採用 Tailwind CSS Class 進行高密度佈局。





2\. \*\*交易解析健壯性 (Parser Robustness)\*\*：

\* CSV 解析器需具備容錯能力（包含日期格式轉換 `YYYY-MM-DD` / `YYYY/MM/DD`、自動清洗欄位空格與大小寫）。





3\. \*\*設計還原度 (Design Fidelity)\*\*：

\* 嚴格保持暗色科技感，數據與變動標示使用 Mono 體（Monospace Font）。

\* 使用者上傳的自研模型卡片需有醒目的視覺特徵（例如 `CUSTOM QUANT` 亮綠/亮紫 Badge），且能無縫參與頁面的「排序」與「篩選」。







```



## 價格數據庫更新指引 (Price Database Update Guide)

自研量化模型與大盤對比走勢依賴 `prices.json` 中的歷史每日收盤價。如需即時更新歷史價格數據，請依照下列說明執行更新腳本：

1. **執行環境與依賴**
   * 本專案包含內置的 Node.js 價格抓取工具 `scripts/fetch_prices.js`。
   * 它會讀取 `Leviathan.csv` 中的交易標的（如台積電 2330.TW、美股等），並自動與大盤基準 `0050.TW`、美元對台幣匯率 `TWD=X` 進行整合。
   * 資料來源使用 **Yahoo Finance API** 的 chart 接口，免金鑰且具備高穩定性。

2. **執行更新指令**
   在專案根目錄下開啟終端機（PowerShell 或 Bash），執行以下命令：
   ```bash
   node scripts/fetch_prices.js
   ```

3. **自動校準與整合**
   * 執行完畢後，腳本會抓取從 `2025-10-01` 開始至最新交易日期的每日收盤價，並直接寫入更新 `prices.json`。
   * 刷新前台頁面後，系統會自動使用最新收盤價重新跑回測，即時展示最新淨值與走勢圖。


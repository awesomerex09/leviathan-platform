# Leviathan 量化系統後台管理系統使用說明書 (README_ADMIN.md)

本說明書旨在指導管理員操作 Leviathan 量化平台後台 (`admin.html`)，進行 10 大關鍵量化指標之動態開關控制、自研量化模型交易明細 CSV 上傳與即時回測發布，並說明雙軌運算備援機制。

---

## 1. 前台指標顯示動態控制 (Display Settings Matrix)

後台控制台提供 10 大法人級關鍵量化指標之多選開關陣列 (Checkbox Matrix)。管理員可依需求勾選或取消勾選特定指標：

| 指標名稱 | 英文代號 | 前台 DOM Box ID | 說明與數學定義 |
| :--- | :--- | :--- | :--- |
| **總報酬率** | Total Return | `box-total` | 模型成立迄今之累積總投資報酬率 (%) |
| **年化報酬率** | Annualized Return | `box-annual` | 複利計算之年化幾何報酬率 (%) |
| **歷史最高報酬** | Max Return | `box-max` | 歷史淨值高點相較初始資金之最高報酬率 (%) |
| **最大回撤** | Max Drawdown (MDD) | `box-mdd` | 歷史波段淨值從高點跌至低點之最大跌幅 (%) |
| **當前回撤** | Current Drawdown (CDD) | `box-cdd` | 最新淨值相較歷史最高高點之當前縮水幅度 (%) |
| **夏普比率** | Sharpe Ratio | `box-sharpe` | 每承受一單位總風險所獲得之超額報酬 ($R_f=2\%$) |
| **索提諾比率** | Sortino Ratio | `box-sortino` | 每承受一單位下行風險所獲得之超額報酬 |
| **卡馬比率** | Calmar Ratio | `box-calmar` | 年化報酬率與最大回撤之比值 ($\text{Annualized} / \vert\text{MDD}\vert$) |
| **Alpha 超額報酬**| Alpha ($\alpha$) | `box-alpha` | 相較大盤 Benchmark (0050.TW) 之風險調整後超額報酬 (%) |
| **Beta 比率** | Beta ($\beta$) | `box-beta` | 模型報酬相對於大盤 Benchmark (0050.TW) 之敏感度係數 |

### 運作原理：
* **即時同步**：後台勾選變更時，系統會自動發送 `POST /api/settings` 更新伺服器端 `settings.json`，並同步寫入瀏覽器 `localStorage ('leviathan_settings')`。
* **無縫顯隱**：前台 (`etf.html`) 在渲染數據時會依據設定檔動態切換各 Data Box 之 `display` 狀態，無需重新編譯頁面。

---

## 2. 交易紀錄 CSV 上傳與即時回測流程 (Data Upload & Backtest)

### 操作步驟：
1. 開啟 `/admin.html` 控制台。
2. 將自研模型之歷史交易明細檔 (`.csv`) 拖曳至上傳區域，或點擊上傳區域選擇檔案。
3. 系統自動解析 CSV 內容並送交 `/api/upload` 觸發即時回測。
4. 計算完成後，預覽區將展示 10 大指標數據，並自動發布至前台 `/etf.html?code=LEVIATHAN`。

### CSV 格式規範：
檔案需包含以下必要欄位：
```csv
Symbol,Side,Qty,Price,Commission,Date
NASDAQ:NVDA,Buy,100,120.5,1.5,2024-01-15 09:30:00
TWSE:2330,Buy,1000,580,20,2024-02-01 10:00:00
```
* **Symbol**：標的代號（支援 `TWSE:`, `TPEX:`, `NASDAQ:`, `NYSE:` 前綴）。
* **Side**：交易方向（`Buy` 買進, `Sell` 賣出, `Dividend` 股利）。
* **Qty / Price / Commission**：數量、成交單價與手續費。
* **Date**：交易時間戳記。

---

## 3. 雙軌運算與雲端備援機制 (Dual-Mode Architecture)

本系統支援「Node.js 本地環境」與「Vercel / 靜態雲端環境」雙軌無縫備援：

### A. Node.js 本地運行環境 (`scripts/serve.js`)
* **核心服務**：`node scripts/serve.js` (Port 3000)。
* **API 介面**：
  * `GET /api/settings`：讀取 `settings.json`（附帶 `Cache-Control: no-store` Header）。
  * `POST /api/settings`：寫入 `settings.json`。
  * `GET /api/backtest`：執行伺服器端高精度回測。
  * `POST /api/upload`：實體更新 `Leviathan.csv` 並建立 `.bak` 備份。
  * `POST /api/clear`：還原為預設模型。

### B. Vercel / 全靜態託管環境 (`shared-preview-data.js`)
* 在無 Node.js API 支援（純靜態託管）時，系統會自動切換至前端 JS 運算模式：
  * **Cache-Buster 防護**：自動為 fetch 請求附加 `?_t=${Date.now()}` 時間戳與 `no-store` 指令。
  * **LocalStorage 備援**：設定開關儲存於 `localStorage`，確保跨頁面與重新整理後狀態不遺失。
  * **前端極速回測**：由 `shared-preview-data.js` 於瀏覽器端即時解析 `Leviathan.csv` 與 `prices.json` 並繪製走勢圖。

---

## 4. 本次升級成果與改版紀錄 (Release Summary)

1. **五大進階風險與超額報酬指標擴充**：
   - 新增 Current Drawdown (CDD), Sharpe Ratio, Calmar Ratio, Beta ($\beta$), Alpha ($\alpha$)。
   - 大盤基準統一採用 `0050.TW`，無風險利率基準 $R_f = 2\%$。
2. **改版檔案清單**：
   - `scripts/serve.js`：API 路由與量化引擎擴充。
   - `shared-preview-data.js`：Cache-Buster 防護與前端運算同步。
   - `admin.html`：10 宮格數據預覽與指標控制勾選陣列。
   - `etf.html`：10 宮格容器獨立 ID 與動態開關顯隱控制。
   - `settings.json`：指標顯示設定檔。
   - `README_ADMIN.md`：後台使用說明書與系統文件。

---

## 5. 如何進入後台與修改前台內容 (User Access Guide)

### A. 進入後台步驟：
1. **開啟後台頁面**：
   - **本地 Node.js 模式**：請開啟瀏覽器訪問 `http://localhost:3000/admin.html`。
   - **Vercel / 雲端託管模式**：請訪問您的專案網域並加上 `/admin.html`（例如 `https://etfedge.xyz/admin.html`）。
   - **純靜態檔案模式**：直接在檔案總管中雙擊開啟 `admin.html`。

### B. 修改前台內容與指標開關：
1. **動態控制前台 10 大指標**：
   - 進入後台頂部的「前台指標顯示動態控制」勾選矩陣。
   - 勾選或取消勾選欲顯示之指標（如：總報酬率、夏普比率、Alpha 等）。
   - 變更將即時同步至 `settings.json` 與瀏覽器 `localStorage`，前台 (`etf.html`) 隨即無縫顯隱對應方塊。

2. **上傳新交易明細與更新發布模型**：
   - 拖曳符合格式之交易紀錄 CSV 至拖曳區域。
   - 系統將自動執行回測運算並更新 10 宮格預覽及前台自研模型數據。

3. **還原預設模型**：
   - 點擊「清除目前發布模型」按鈕，即可將前台發布之自研模型重置還原。

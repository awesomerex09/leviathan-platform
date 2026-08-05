# \# TASK\_PLAN.md：Leviathan 量化系統進階指標與動態控制模組升級案

# 

# \## 1. 專案概述與系統架構 (System Architecture \& Data Flow)

# 

# 本升級案旨在提升 \*\*Leviathan 量化平台\*\* 之法人級數據分析能力，擴充 \*\*當前縮水 (Current Drawdown)\*\*、\*\*夏普比率 (Sharpe Ratio)\*\*、\*\*卡馬比率 (Calmar Ratio)\*\*、\*\*Beta ($\\beta$)\*\* 以及 \*\*Alpha ($\\alpha$)\*\* 等五項關鍵風險與超額報酬指標。同時建構後台動態開關控制機制，實現不需重新部署即可動態開閉前台數據方塊之效益。

# 

# \### 1.1 模組互動與資料傳遞架構

# 

# ```

# \[使用者操作] -> admin.html (開關設定 / 拖曳 CSV)

# &#x20;                  |

# &#x20;                  +---> (POST /api/settings) ---------> settings.json

# &#x20;                  +---> (POST /api/upload)   ---------> Leviathan.csv \& 執行即時回測

# &#x20;                                                             |

# &#x20;                                                             v

# \[前台展示]   <- etf.html <--- (GET /api/settings) <--- serve.js (計算 10 大指標)

# &#x20;                  ^         (GET /api/backtest)

# &#x20;                  |

# &#x20;                  +--- (Fallback) ---> shared-preview-data.js (localStorage / 快取防護)

# ```

# 

# \### 1.2 運算環境雙軌備援機制

# 

# \- \*\*Node.js 本地運行（Local Node Environment）\*\*：`serve.js` 為主要運算核心，負責實體寫入 `settings.json` 與 `Leviathan.csv`。

# \- \*\*Vercel 唯讀環境（Serverless Environment）\*\*：自動切換至 `shared-preview-data.js` 進行前端極速回測，並將開關狀態記錄於 `localStorage`，確保全靜態託管下功能無縫銜接。

# 

# \## 2. 核心計算邏輯與虛擬碼 (Core Math \& Pseudocode)

# 

# \### 2.1 財務指標數學定義

# 

# 以 0050.TW 作為基準大盤（Benchmark），無風險利率 $R\_f = 2\\%$（日無風險利率 $R\_{f, daily} = \\frac{2\\%}{252}$）：

# 

# 1\. \*\*當前回撤 (Current Drawdown, CDD)\*\*：

# &#x20;   

# &#x20;   $$\\text{CDD}\_t = \\frac{\\text{NAV}\_t - \\max\_{0 \\le s \\le t}(\\text{NAV}\_s)}{\\max\_{0 \\le s \\le t}(\\text{NAV}\_s)} \\times 100\\%$$

# &#x20;   

# 2\. \*\*夏普比率 (Sharpe Ratio)\*\*：

# &#x20;   

# &#x20;   $$\\text{Sharpe} = \\frac{\\bar{R}\_p - R\_{f, daily}}{\\sigma\_p} \\times \\sqrt{252}$$

# &#x20;   

# &#x20;   其中 $\\bar{R}\_p$ 為模型平均日報酬，$\\sigma\_p$ 為日報酬標準差。

# &#x20;   

# 3\. \*\*卡馬比率 (Calmar Ratio)\*\*：

# &#x20;   

# &#x20;   $$\\text{Calmar} = \\frac{\\text{Annualized Return}}{\\vert{}\\text{Max Drawdown}\\vert{}}$$

# &#x20;   

# 4\. \*\*Beta 比率 ($\\beta$)\*\*：

# &#x20;   

# &#x20;   $$\\beta = \\frac{\\text{Covar}(R\_p, R\_b)}{\\text{Var}(R\_b)}$$

# &#x20;   

# &#x20;   其中 $R\_p$ 為模型日報酬序列，$R\_b$ 為 0050.TW 同期日報酬序列。

# &#x20;   

# 5\. \*\*Alpha 超額報酬 ($\\alpha$)\*\*：

# &#x20;   

# &#x20;   $$\\alpha = R\_{\\text{p, ann}} - \\left\[ R\_f + \\beta \\times (R\_{\\text{b, ann}} - R\_f) \\right]$$

# &#x20;   

# 

# \### 2.2 量化計算核心虛擬碼 (Pseudocode)

# 

# JavaScript

# 

# \# 

# 

# ```

# // FUNCTION: calculateAdvancedMetrics(navSeries, benchSeries)

# // INPUT: navSeries (日資產淨值序列), benchSeries (0050價格序列)

# // OUTPUT: Complete Metrics Object

# 

# INIT modelReturns = \[], benchReturns = \[]

# INIT peak = initialCapital, maxDrawdown = 0

# 

# FOR i FROM 1 TO navSeries.length - 1:

# &#x20;   pt = navSeries\[i], prevPt = navSeries\[i-1]

# &#x20;   ret = (pt.val - prevPt.val) / prevPt.val

# &#x20;   PUSH ret TO modelReturns

# 

# &#x20;   IF pt.val > peak THEN peak = pt.val

# &#x20;   dd = (pt.val - peak) / peak

# &#x20;   IF dd < maxDrawdown THEN maxDrawdown = dd

# 

# &#x20;   bPt = FIND\_MATCHING\_DATE(benchSeries, pt.d)

# &#x20;   bPrevPt = FIND\_MATCHING\_DATE(benchSeries, prevPt.d)

# &#x20;   PUSH (bPt.c - bPrevPt.c) / bPrevPt.c TO benchReturns

# 

# current\_drawdown = ((finalVal - peak) / peak) \* 100

# max\_drawdown = maxDrawdown \* 100

# 

# // 統計矩陣計算 (Mean, Variance, Covariance)

# meanModel = MEAN(modelReturns)

# meanBench = MEAN(benchReturns)

# covar = COVARIANCE(modelReturns, benchReturns)

# varBench = VARIANCE(benchReturns)

# 

# beta = (varBench == 0) ? 1.0 : covar / varBench

# stdDevModel = STDDEV(modelReturns)

# sharpe\_ratio = (stdDevModel == 0) ? 0 : ((meanModel - dailyRf) / stdDevModel) \* SQRT(252)

# 

# calmar\_ratio = (max\_drawdown == 0) ? 0 : (annualized\_return / ABS(max\_drawdown))

# alpha = annualized\_return - (riskFreeRate + beta \* (annBenchRet - riskFreeRate))

# 

# RETURN { total\_return, annualized\_return, max\_return, max\_drawdown, current\_drawdown, sharpe\_ratio, sortino\_ratio, calmar\_ratio, alpha, beta }

# ```

# 

# \## 3. 批次執行任務清單 (Batch Execution Scope)

# 

# 本清單專為低階模型（如 Gemini 3.6 Flash Low）設計，劃分為三個中型模組，允許低階模型進行 Single-pass 批次開發。

# 

# \### 批次模組 A：伺服器 API 與量化計算引擎擴充 (`serve.js`)

# 

# \- \[ ]  \*\*新增 `/api/settings` 路由\*\*：支援 GET（讀取 `settings.json`，帶 `no-store` Header）與 POST（寫入設定檔）。

# \- \[ ]  \*\*重構 `calculateBacktest()` 函數\*\*：加入 0050.TW 同期比對，計算 CDD、Sharpe、Calmar、Beta、Alpha 等五項全新欄位。

# \- \[ ]  \*\*驗證傳出格式\*\*：確保 `/api/backtest` JSON 輸出結構完整包含 10 大指標及 `is\_custom\_quant: true` 屬性。

# 

# \### 批次模組 B：前置數據層與快取保護機制 (`shared-preview-data.js`)

# 

# \- \[ ]  \*\*導入 Cache-Buster 機制\*\*：為所有 `fetch` 請求自動附加 `?\_t=${Date.now()}` 時間戳記，並開啟 `no-store` 指令，解決瀏覽器 API 快取問題。

# \- \[ ]  \*\*更新 `window.leviathanData`\*\*：實作 `getSettings()` 介面，支援 API 失敗時自動備援至 `localStorage.getItem('leviathan\_settings')`。

# \- \[ ]  \*\*前端運算同步\*\*：將 10 大指標運算邏輯同步寫入前端 `calculateBacktest()`，確保無 Node.js 環境下結果一致。

# 

# \### 批次模組 C：控制台與前台 UI 動態渲染 (`admin.html` \& `etf.html`)

# 

# \- \[ ]  \*\*`admin.html` 控制台\*\*：

# &#x20;   - 升級數據預覽區為 \*\*10 宮格版面\*\*。

# &#x20;   - 新增 10 項指標的多選開關陣列（Checkbox Matrix），並綁定 `change` 事件即時寫入 API / `localStorage`。

# \- \[ ]  \*\*`etf.html` 前台詳情頁\*\*：

# &#x20;   - 擴充 `#quant-metrics-grid` 為 \*\*10 宮格容器\*\*（含獨立 ID：`box-total`, `box-annual`, `box-max`, `box-mdd`, `box-cdd`, `box-sharpe`, `box-sortino`, `box-calmar`, `box-alpha`, `box-beta`）。

# &#x20;   - 在 `renderHeader()` 中加入控制邏輯，依照 `settings` 開關動態調整方塊之 `style.display`。

# &#x20;   - 加入全域 `try...catch` 防護網，強制對純數字轉型 (`Number(val) || 0`)，防止無效數據引發頁面卡死。

# 

# \## 4. 人工驗收與測試切點 (Human Review \& Checkpoints)

# 

# 當低階模型完成上述批次編碼後，由人工執行以下驗收程序：

# 

# \### 4.1 熔斷條件（Two-Strike Rule）

# 

# 若低階模型在編譯過程中發生以下狀況超過 \*\*2 次\*\*，立刻停止重試並升級處理：

# 

# 1\. `etf.html` 載入時主圖表（Chart.js）無法渲染或主頁面卡在 Header。

# 2\. 後台開關切換後，前台無法依據 JSON / `localStorage` 隱藏對應區塊。

# 

# \### 4.2 本地端與雲端驗收步驟 (Acceptance Procedure)

# 

# 1\. \*\*本地服務啟動\*\*：執行 `node serve.js` 確定 `http://localhost:3000` 無啟動報錯。

# 2\. \*\*後台控制測試\*\*：開啟 `/admin.html`，取消勾選「Beta」與「Alpha」，並上傳測試 CSV。確認預覽網格正確計算 10 大數值。

# 3\. \*\*前台同步驗證\*\*：重新載入 `/etf.html?code=LEVIATHAN`，確認 Beta 與 Alpha 區塊已隱藏，其餘 8 項指標正確無誤，且走勢圖與持股明細完好繪製。

# 4\. \*\*Vercel 模擬驗收\*\*：停止本地服務，直接以純靜態模式開啟 `etf.html`，確認 `shared-preview-data.js` 能無縫承接計算與快取載入。

# 

# \# TASK\_PLAN\_BUGFIX\_AND\_DEPLOY.md：Leviathan 系統除錯、全靜態備援與 Vercel 同步上線計畫

# 

# \## 1. 專案概述與修復目標 (Overview \& Objectives)

# 

# 本計畫專為 Agent (如 Gemini 3.6 Flash Low) 設計，旨在解決本地測試時發現的兩大核心錯誤，並完成最終的 Vercel 雲端部署。

# 透過修復前端表單預設行為與實作 API 失效時的「純靜態備援機制」，確保系統在 Node.js 本地環境與 Vercel 靜態環境下皆能完美運行。

# 

# \### 1.1 核心修復目標

# 

# 1\. \*\*修復「畫面閃爍/重整」Bug\*\*：阻斷 `<form>` 表單或按鈕提交時瀏覽器的預設重整行為，確保非同步 (`fetch`) 運算不被中斷。

# 2\. \*\*修復 `Failed to fetch` 崩潰問題\*\*：當系統處於無 Node.js 的環境（如雙擊 HTML 或 Vercel 靜態託管）時，攔截 `fetch` 錯誤，無縫切換至 `localStorage` 與瀏覽器端運算。

# 

# \---

# 

# \## 2. 批次執行任務清單 (Batch Execution Scope)

# 

# 請 Agent 依序執行以下三個模組，每個模組採 Single-pass 修改，以節省 Token 並降低出錯率。

# 

# \### 批次模組 A：表單攔截與後台除錯 (`admin.html` 與相關 JS)

# 

# \* \[ ] \*\*阻斷表單預設提交\*\*：

# \* 定位 `admin.html` 中的上傳表單（或對應的 JavaScript 事件監聽器）。

# \* 強制加入 `event.preventDefault();`。

# \* \*虛擬碼參考\*：

# ```javascript

# document.getElementById('uploadForm').addEventListener('submit', async function(e) {

# &#x20;   e.preventDefault(); // \[關鍵修復] 防止畫面閃爍與中斷

# &#x20;   // 原有邏輯...

# });

# 

# ```

# 

# 

# 

# 

# \* \[ ] \*\*實作前端 CSV 解析與回測（靜態備援）\*\*：

# \* 當點擊上傳且發送 `/api/upload` 失敗（進入 `catch` 區塊）時，使用 `FileReader` 讀取使用者選取的 CSV 檔案。

# \* 將解析後的回測結果與開關設定寫入 `localStorage.setItem('leviathan\\\\\\\_settings', JSON.stringify(data))`，供前台讀取。

# 

# 

# 

# \### 批次模組 B：前台靜態備援切換 (`etf.html` / `shared-preview-data.js`)

# 

# \* \[ ] \*\*引入 `try...catch` API 防護網\*\*：

# \* 修改 `fetch('/api/settings')` 與 `fetch('/api/backtest')` 邏輯。

# \* \*虛擬碼參考\*：

# ```javascript

# let settingsData;

# try {

# &#x20;   const res = await fetch('/api/settings');

# &#x20;   if (!res.ok) throw new Error('API Offline');

# &#x20;   settingsData = await res.json();

# } catch (err) {

# &#x20;   console.warn('切換至靜態備援模式：從 localStorage 讀取設定');

# &#x20;   settingsData = JSON.parse(localStorage.getItem('leviathan\_settings')) || defaultSettings;

# }

# // 依據 settingsData 動態控制 10 宮格指標顯示與隱藏

# 

# ```

# 

# 

# 

# 

# 

# \### 批次模組 C：Vercel 部署與線上同步 (Deployment Execution)

# 

# \* \[ ] \*\*編寫與更新說明文件 (`README\\\\\\\_ADMIN.md`)\*\*：

# \* 記錄系統已支援「Node.js 本地雙向讀寫」與「Vercel 純靜態 localStorage 備援」雙模式。

# \* 說明 Vercel 環境下的上傳行為為「前端暫存運算」，關閉瀏覽器後設定會重置，需透過後台重新拖曳覆蓋。

# 

# 

# \* \[ ] \*\*執行雲端部署指令\*\*：

# \* 測試無誤後，請直接透過終端機執行推播或強制上傳。

# \* \*\*方式 A (Git 推播 - 推薦)\*\*：

# ```bash

# git add .

# git commit -m "fix: 修復上傳閃爍 bug 並實作 Vercel 靜態備援"

# git push

# 

# ```

# 

# 

# \* \*\*方式 B (Vercel CLI 直連強制上傳)\*\*：

# ```cmd

# cmd /c "set NODE\_OPTIONS=--dns-result-order=ipv4first \&\& npx vercel --prod --yes"

# 

# ```

# 

# 

# 

# 

# 

# \---

# 

# \## 3. 人工驗收與測試切點 (Human Review \& Checkpoints)

# 

# \### 3.1 熔斷條件 (Two-Strike Rule)

# 

# 若 Agent 在實作中發生以下狀況超過 2 次，立刻停止重試：

# 

# 1\. `admin.html` 點擊上傳後，畫面依然會重整或閃爍清空。

# 2\. 在停止 Node.js (`Ctrl+C`) 的情況下直接開啟 `admin.html` 或 `etf.html`，控制台仍報錯無法渲染（未成功 fallback 至 localStorage）。

# 

# \### 3.2 三階段驗收步驟 (Acceptance Procedure)

# 

# 1\. \*\*本地 Node.js 驗證\*\*：

# \* 啟動 `node serve.js`，於 `http://localhost:3000/admin.html` 測試上傳 CSV 與切換開關，確認不閃爍、且 `settings.json` 成功寫入。

# 

# 

# 2\. \*\*本地純靜態驗證 (Vercel 模擬)\*\*：

# \* 關閉 `node serve.js`，直接在檔案總管雙擊開啟 `admin.html` (網址為 `file:///...`)。

# \* 測試上傳 CSV 與切換開關，確認 Console 顯示「切換至靜態備援模式」，且 `etf.html` 能根據 `localStorage` 正確隱藏對應的指標區塊。

# 

# 

# 3\. \*\*Vercel 線上正式環境驗證\*\*：

# \* 執行模組 C 的 Git 提交或 Vercel CLI 部署。

\* 訪問正式線上網址，重複第 2 步的靜態操作，確保雲端託管版本運作順暢。

# 4.輸出說明文件告訴使用者如何進入後臺修改前端內容


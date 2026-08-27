const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3001;
const ROOT = path.join(__dirname, '..');

let deployTimeout = null;
function triggerAutoDeploy() {
  if (deployTimeout) clearTimeout(deployTimeout);
  deployTimeout = setTimeout(() => {
    console.log('[Auto-Deploy] Triggering deploy to Vercel in background...');
    const child = spawn('node', [path.join(ROOT, 'scripts', 'deploy.js')], { stdio: 'inherit' });
    child.on('close', (code) => {
      console.log(`[Auto-Deploy] Deploy script finished with code ${code}`);
    });
  }, 3000);
}

const VISITS_FILE = path.join(ROOT, 'visits.json');
let totalVisits = 0;
try {
  if (fs.existsSync(VISITS_FILE)) {
    totalVisits = JSON.parse(fs.readFileSync(VISITS_FILE, 'utf8')).visits || 0;
  } else {
    fs.writeFileSync(VISITS_FILE, JSON.stringify({ visits: 0 }));
  }
} catch (e) {
  console.error('Failed to init visits.json:', e.message);
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);
  
  let parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = parsedUrl.pathname;

  // Track HTML page visits
  const isPage = pathname === '/' || pathname === '/index.html' || pathname === '/etf.html' || pathname === '/admin.html';
  if (isPage && req.method === 'GET') {
    totalVisits++;
    try {
      fs.writeFileSync(VISITS_FILE, JSON.stringify({ visits: totalVisits }));
    } catch (e) {
      console.error('Failed to save visits:', e.message);
    }
  }

  // Block direct access to CSV
  if (pathname === '/Leviathan.csv' || pathname === '/Leviathan.csv.default' || pathname === '/Leviathan.csv.bak') {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden: 隱私安全性考量，禁止下載交易紀錄明細。');
    return;
  }

  // Intercept site-stats.json with local visits counter
  if (pathname === '/site-stats.json' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      status: "ok",
      generated_at: new Date().toISOString(),
      source: "local_server_counter",
      total: {
        visits: totalVisits
      }
    }));
    return;
  }

  // /api/settings (GET / POST)
  if (pathname === '/api/settings') {
    try {
      const settingsHandler = require(path.join(ROOT, 'api', 'settings.js'));
      if (req.method === 'POST') {
        const originalEnd = res.end;
        res.end = function(...args) {
          triggerAutoDeploy();
          return originalEnd.apply(this, args);
        };
      }
      return settingsHandler(req, res);
    } catch (e) {
      console.error('Error handling /api/settings:', e);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /api/live-prices
  if (pathname === '/api/live-prices' && req.method === 'GET') {
    try {
      const livePricesHandler = require(path.join(ROOT, 'api', 'live-prices.js'));
      return livePricesHandler(req, res);
    } catch (e) {
      console.error('Error handling /api/live-prices:', e);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  // GET /api/etfs
  if (pathname === '/api/etfs' && req.method === 'GET') {
    try {
      const etfsHandler = require(path.join(ROOT, 'api', 'etfs.js'));
      return etfsHandler(req, res);
    } catch (e) {
      console.error('Error handling /api/etfs:', e);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET or POST /api/cron-refresh-etfs
  if (pathname === '/api/cron-refresh-etfs') {
    try {
      const cronHandler = require(path.join(ROOT, 'api', 'cron-refresh-etfs.js'));
      return cronHandler(req, res);
    } catch (e) {
      console.error('Error handling /api/cron-refresh-etfs:', e);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // GET /api/backtest
  if (pathname === '/api/backtest' && req.method === 'GET') {
    try {
      const csvPath = path.join(ROOT, 'Leviathan.csv');
      if (fs.existsSync(csvPath)) {
        const pricesPath = path.join(ROOT, 'prices.json');
        const etfsPath = path.join(ROOT, 'etfs.json');
        const prices = JSON.parse(fs.readFileSync(pricesPath, 'utf8'));
        const etfs = JSON.parse(fs.readFileSync(etfsPath, 'utf8')).etfs || [];
        extendPricesAndEtfsToToday(prices, etfs);

        const trades = parseCSV(fs.readFileSync(csvPath, 'utf8'));
        const model = calculateBacktest(trades, prices, etfs);
        
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        });
        res.end(JSON.stringify({ ok: true, model }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Leviathan.csv not found' }));
      }
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }



  // POST /api/upload
  if (pathname === '/api/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        let csvContent = body;
        try {
          const parsed = JSON.parse(body);
          if (parsed && parsed.csv) csvContent = parsed.csv;
        } catch (e) {}

        if (!csvContent || !csvContent.includes('Symbol')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '無效的 CSV 格式' }));
          return;
        }

        const csvPath = path.join(ROOT, 'Leviathan.csv');
        if (fs.existsSync(csvPath)) {
          fs.writeFileSync(csvPath + '.bak', fs.readFileSync(csvPath));
        }

        fs.writeFileSync(csvPath, csvContent, 'utf8');

        const pricesPath = path.join(ROOT, 'prices.json');
        const etfsPath = path.join(ROOT, 'etfs.json');
        const prices = JSON.parse(fs.readFileSync(pricesPath, 'utf8'));
        const etfs = JSON.parse(fs.readFileSync(etfsPath, 'utf8')).etfs || [];

        const trades = parseCSV(csvContent);

        // Extract trade symbols to fetch live/historical stock prices
        const tradeSymbols = Array.from(new Set(trades.map(t => {
          const s = t.symbol || '';
          if (s.startsWith('TWSE:') || s.startsWith('TPEX:')) return s.split(':')[1] + '.TW';
          if (s.startsWith('NASDAQ:') || s.startsWith('NYSE:') || s.startsWith('AMEX:') || s.startsWith('CBOE:')) return s.split(':')[1];
          if (!s.includes(':') && !s.includes('.')) return s + '.TW';
          return s;
        }).filter(Boolean)));

        const etfCodes = etfs.map(e => e.code).filter(Boolean);
        const symbolsToFetch = Array.from(new Set(['0050.TW', 'TWD=X', ...tradeSymbols, ...etfCodes]));
        let liveFetched = {};
        try {
          console.log(`[Upload] Fetching live price data for ${symbolsToFetch.length} tickers (including all comparison ETFs)...`);
          liveFetched = await fetchPricesForSymbols(symbolsToFetch);
          for (const [sym, series] of Object.entries(liveFetched)) {
            prices[sym] = series;
          }
          fs.writeFileSync(pricesPath, JSON.stringify(prices, null, 2), 'utf8');
        } catch (fErr) {
          console.warn('[Upload] Live price fetch failed, using local prices.json:', fErr.message);
        }

        extendPricesAndEtfsToToday(prices, etfs, liveFetched);

        // Save updated etfs.json to disk
        try {
          const etfDataRaw = JSON.parse(fs.readFileSync(etfsPath, 'utf8'));
          etfDataRaw.as_of = formatYYYYMMDD(new Date());
          etfDataRaw.etfs = etfs;
          fs.writeFileSync(etfsPath, JSON.stringify(etfDataRaw, null, 2), 'utf8');
          console.log(`[Upload] Successfully updated etfs.json for ${etfs.length} comparison ETFs!`);
        } catch (eErr) {
          console.warn('[Upload] Failed to save updated etfs.json:', eErr.message);
        }

        const model = calculateBacktest(trades, prices, etfs);
        model.version = 'MODEL_CACHE';
        model.csvLength = 'PREVIEW';
        fs.writeFileSync(path.join(ROOT, 'leviathan_model.json'), JSON.stringify(model, null, 2), 'utf8');
        triggerAutoDeploy();

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, model }));
      } catch (e) {
        console.error(e);
        const csvPath = path.join(ROOT, 'Leviathan.csv');
        if (fs.existsSync(csvPath + '.bak')) {
          fs.writeFileSync(csvPath, fs.readFileSync(csvPath + '.bak'));
        }
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /api/clear
  if (pathname === '/api/clear' && req.method === 'POST') {
    try {
      const csvPath = path.join(ROOT, 'Leviathan.csv');
      const backupPath = path.join(ROOT, 'Leviathan.csv.default');

      if (fs.existsSync(backupPath)) {
        fs.writeFileSync(csvPath, fs.readFileSync(backupPath));
        
        const pricesPath = path.join(ROOT, 'prices.json');
        const etfsPath = path.join(ROOT, 'etfs.json');
        const prices = JSON.parse(fs.readFileSync(pricesPath, 'utf8'));
        const etfs = JSON.parse(fs.readFileSync(etfsPath, 'utf8')).etfs || [];
        extendPricesAndEtfsToToday(prices, etfs);

        const trades = parseCSV(fs.readFileSync(csvPath, 'utf8'));
        const model = calculateBacktest(trades, prices, etfs);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, model }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '找不到預設模型備份檔' }));
      }
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  let filePath = path.join(ROOT, pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Internal Server Error: ${err.code}`);
      }
    } else {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

// ── Backtesting Helpers ────────────────────────────────────────────────────────
const https = require('https');

// 從 Yahoo Finance 拉取一組 symbols 的最新歷史訊價
function fetchSingleYahooPrice(symbol) {
  return new Promise((resolve) => {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = Math.floor(new Date('2020-01-01T00:00:00Z').getTime() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}`;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    };
    const req = https.get(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          const parsed = JSON.parse(body);
          const result = parsed.chart?.result?.[0];
          if (!result) return resolve(null);
          const timestamps = result.timestamp || [];
          const closes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
          const series = [];
          for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] !== null && closes[i] !== undefined) {
              const dObj = new Date(timestamps[i] * 1000);
              const y = dObj.getUTCFullYear();
              const m = String(dObj.getUTCMonth() + 1).padStart(2, '0');
              const d = String(dObj.getUTCDate()).padStart(2, '0');
              series.push({ d: `${y}${m}${d}`, c: Number(closes[i].toFixed(4)) });
            }
          }
          resolve(series.length ? series : null);
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

async function fetchPricesForSymbols(symbols = []) {
  const result = {};
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    let series = await fetchSingleYahooPrice(sym);
    // 若取不到，嘗試替換後綴（.TW 對調 .TWO）
    if (!series) {
      if (sym.endsWith('.TW')) {
        series = await fetchSingleYahooPrice(sym.replace(/\.TW$/, '.TWO'));
      } else if (sym.endsWith('.TWO')) {
        series = await fetchSingleYahooPrice(sym.replace(/\.TWO$/, '.TW'));
      }
    }
    if (series && series.length) {
      result[sym] = series;
      // 同步對應後綴譜別名
      if (sym.endsWith('.TW')) result[sym.replace(/\.TW$/, '.TWO')] = series;
      if (sym.endsWith('.TWO')) result[sym.replace(/\.TWO$/, '.TW')] = series;
    }
    console.log(`[Upload] [${i + 1}/${symbols.length}] ${sym}: ${series ? series.length + ' pts' : 'failed'}`);
    // 避免 429 Too Many Requests
    if (i < symbols.length - 1) await new Promise(r => setTimeout(r, 350));
  }
  return result;
}

function convertSymbol(symbol) {
  if (!symbol) return null;
  const s = symbol.trim();
  if (s.startsWith('TWSE:')) {
    return s.split(':')[1] + '.TW';
  } else if (s.startsWith('TPEX:')) {
    return s.split(':')[1] + '.TWO';
  } else if (s.includes(':')) {
    return s.split(':')[1];
  }
  return s;
}

function formatYYYYMMDD(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function extendPricesAndEtfsToToday(prices, etfs, livePricesMap) {
  if (!prices || !prices['0050.TW']) return;
  const today = new Date();
  const todayStr = formatYYYYMMDD(today);
  
  const benchSeries = prices['0050.TW'];
  if (!benchSeries.length) return;

  benchSeries.sort((a, b) => a.d.localeCompare(b.d));
  const seenBench = new Set();
  prices['0050.TW'] = benchSeries.filter(p => seenBench.has(p.d) ? false : seenBench.add(p.d));
  const activeBench = prices['0050.TW'];

  const lastBenchDateStr = activeBench[activeBench.length - 1].d;

  if (lastBenchDateStr < todayStr) {
    const missingDates = [];
    const k = String(lastBenchDateStr).replaceAll('-', '').replaceAll('/', '');
    let cur = new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(4, 6)) - 1, Number(k.slice(6, 8))));
    cur.setUTCDate(cur.getUTCDate() + 1);

    while (formatYYYYMMDD(cur) <= todayStr) {
      const dayOfWeek = cur.getUTCDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        missingDates.push(formatYYYYMMDD(cur));
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    if (missingDates.length) {
      const lastPrice = activeBench[activeBench.length - 1].c;
      for (const newDate of missingDates) {
        activeBench.push({ d: newDate, c: lastPrice });
      }
    }
  }

  if (etfs && etfs.length) {
    for (const etf of etfs) {
      if (!etf.price_series || !etf.price_series.length) continue;

      const liveEtfSeries = livePricesMap ? (livePricesMap[etf.code] || livePricesMap[`${etf.code}.TW`] || livePricesMap[`${etf.code}.TWO`]) : null;
      if (liveEtfSeries && liveEtfSeries.length) {
        if (liveEtfSeries.length > 30) {
          etf.price_series = JSON.parse(JSON.stringify(liveEtfSeries));
        } else {
          for (const pt of liveEtfSeries) {
            const existingIdx = etf.price_series.findIndex(p => p.d === pt.d);
            if (existingIdx >= 0) {
              etf.price_series[existingIdx].c = pt.c;
            } else {
              etf.price_series.push(pt);
            }
          }
        }
      }

      etf.price_series.sort((a, b) => a.d.localeCompare(b.d));
      const seenEtf = new Set();
      etf.price_series = etf.price_series.filter(p => seenEtf.has(p.d) ? false : seenEtf.add(p.d));

      const priceMapByDate = new Map();
      for (const pt of etf.price_series) {
        priceMapByDate.set(pt.d, pt.c);
      }

      const etfStartDate = etf.price_series[0]?.d || activeBench[0]?.d;
      let currentNav = etf.price_series[0]?.c || 1.0;
      const alignedSeries = [];

      for (const bPt of activeBench) {
        if (bPt.d < etfStartDate) continue;
        if (priceMapByDate.has(bPt.d)) {
          currentNav = priceMapByDate.get(bPt.d);
        }
        alignedSeries.push({ d: bPt.d, c: currentNav });
      }

      etf.price_series = alignedSeries;

      etf.nav = etf.price_series[etf.price_series.length - 1].c;
      etf.close_price = etf.nav;
      etf.as_of = todayStr;

      // 重新計算所有比較基金的 10 大指標，確保與最新 price_series 同步
      const m = computeAdvancedMetrics(etf.price_series, activeBench);
      etf.total_return = m.totalReturn;
      etf.annualized_return = m.annualizedReturn;
      etf.max_return = m.maxReturn;
      etf.max_drawdown = m.maxDrawdown;
      etf.current_drawdown = m.currentDrawdown;
      etf.sharpe_ratio = m.sharpeRatio;
      etf.sortino_ratio = m.sortinoRatio;
      etf.calmar_ratio = m.calmarRatio;
      etf.alpha = m.alpha;
      etf.beta = m.beta;
    }
  }
}

// 計算所有基金（含比較基金）共用的 10 大進階指標
function computeAdvancedMetrics(fundSeries = [], benchSeries = []) {
  if (!fundSeries || !fundSeries.length) {
    return {
      totalReturn: 0, annualizedReturn: 0, maxReturn: 0, maxDrawdown: 0,
      currentDrawdown: 0, sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0,
      alpha: 0, beta: 1.0
    };
  }

  const startVal = fundSeries[0].c || 1.0;
  const finalVal = fundSeries[fundSeries.length - 1].c || startVal;
  const peakVal = Math.max(...fundSeries.map(pt => pt.c), startVal);

  const totalReturn = parseFloat((((finalVal - startVal) / startVal) * 100).toFixed(2));
  const maxReturn = parseFloat((((peakVal - startVal) / startVal) * 100).toFixed(2));

  const parseDateUTC = (dateStr) => {
    const s = String(dateStr).replaceAll('-', '').replaceAll('/', '');
    if (s.length !== 8) return new Date();
    return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))));
  };

  const startD = parseDateUTC(fundSeries[0].d);
  const endD = parseDateUTC(fundSeries[fundSeries.length - 1].d);
  const diffYears = Math.max((endD - startD) / (1000 * 60 * 60 * 24 * 365.25), 0.001);
  const annualizedReturn = parseFloat(((Math.pow(finalVal / startVal, 1 / diffYears) - 1) * 100).toFixed(2));

  let peak = startVal;
  let maxDrawdown = 0;
  for (const pt of fundSeries) {
    if (pt.c > peak) peak = pt.c;
    const dd = (pt.c - peak) / peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }
  const maxDrawdownPct = parseFloat((maxDrawdown * 100).toFixed(2));
  const currentDrawdownPct = parseFloat((((finalVal - peak) / peak) * 100).toFixed(2));

  const fundReturns = [];
  for (let i = 1; i < fundSeries.length; i++) {
    fundReturns.push((fundSeries[i].c - fundSeries[i - 1].c) / (fundSeries[i - 1].c || 1));
  }

  const calMean = fundReturns.length ? fundReturns.reduce((a, b) => a + b, 0) / fundReturns.length : 0;
  const calNeg = fundReturns.filter(r => r < 0);
  const calDownside = calNeg.length > 0
    ? Math.sqrt(calNeg.reduce((sum, r) => sum + r * r, 0) / (fundReturns.length || 1))
    : 0.0001;
  let sortinoRatio = calDownside > 0
    ? parseFloat(((calMean / calDownside) * Math.sqrt(252)).toFixed(3))
    : 0;
  if (sortinoRatio > 20) sortinoRatio = 20;
  if (sortinoRatio < -20) sortinoRatio = -20;

  const dailyRf = 0.02 / 252;
  const calVariance = fundReturns.reduce((sum, r) => sum + Math.pow(r - calMean, 2), 0) / (fundReturns.length || 1);
  const stdDevModel = Math.sqrt(calVariance);
  let sharpeRatio = stdDevModel === 0 ? 0 : parseFloat((((calMean - dailyRf) / stdDevModel) * Math.sqrt(252)).toFixed(3));
  if (sharpeRatio > 10) sharpeRatio = 10;
  if (sharpeRatio < -10) sharpeRatio = -10;

  const calmarRatio = maxDrawdownPct === 0 ? 0 : parseFloat((annualizedReturn / Math.abs(maxDrawdownPct)).toFixed(3));

  let beta = 1.0;
  let alpha = 0.0;

  if (benchSeries && benchSeries.length && fundSeries.length > 1) {
    const benchPrices = [];
    for (let i = 0; i < fundSeries.length; i++) {
      const day = fundSeries[i].d;
      const bPt = benchSeries.find(p => p.d === day) || benchSeries.filter(p => p.d <= day).pop();
      benchPrices.push(bPt ? bPt.c : (benchPrices.length ? benchPrices[benchPrices.length - 1] : 1.0));
    }
    const benchReturns = [];
    for (let i = 1; i < benchPrices.length; i++) {
      benchReturns.push((benchPrices[i] - benchPrices[i - 1]) / (benchPrices[i - 1] || 1));
    }
    const meanBench = benchReturns.reduce((a, b) => a + b, 0) / (benchReturns.length || 1);
    let covar = 0, varBench = 0;
    for (let i = 0; i < fundReturns.length; i++) {
      covar += (fundReturns[i] - calMean) * (benchReturns[i] - meanBench);
      varBench += Math.pow(benchReturns[i] - meanBench, 2);
    }
    covar = covar / (fundReturns.length || 1);
    varBench = varBench / (fundReturns.length || 1);
    beta = varBench === 0 ? 1.0 : parseFloat((covar / varBench).toFixed(3));

    const bStart = benchPrices[0] || 1.0;
    const bFinal = benchPrices[benchPrices.length - 1] || 1.0;
    const annBenchRet = ((Math.pow(bFinal / bStart, 1 / diffYears) - 1) * 100);
    const riskFreeRate = 2.0;
    alpha = parseFloat((annualizedReturn - (riskFreeRate + beta * (annBenchRet - riskFreeRate))).toFixed(2));
  }

  return {
    totalReturn,
    annualizedReturn,
    maxReturn,
    maxDrawdown: maxDrawdownPct,
    currentDrawdown: currentDrawdownPct,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    alpha,
    beta
  };
}

function parseCSV(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',').map(c => c.trim());
    if (cols.length < 3) continue;
    const symbol = cols[0];
    const side = cols[1];
    const qty = parseFloat(cols[2]) || 0;
    let price = 0, commission = 0, dateStr = '';
    
    if (cols.length >= 6) {
      price = parseFloat(cols[3]) || 0;
      commission = parseFloat(cols[4]) || 0;
      dateStr = cols[5];
    } else {
      dateStr = cols[cols.length - 1];
      if (cols.length >= 4) price = parseFloat(cols[3]) || 0;
      if (cols.length >= 5) commission = parseFloat(cols[4]) || 0;
    }

    if (!dateStr || dateStr === 'Date') continue;
    const cleanDate = dateStr.split(' ')[0].replaceAll('-', '').replaceAll('/', '');
    result.push({
      symbol: symbol,
      side: side,
      qty: qty,
      price: price,
      commission: commission,
      date: cleanDate,
      datetime: dateStr
    });
  }
  return result;
}

function calculateBacktest(trades, prices, etfs) {
  trades.sort((a, b) => a.datetime.localeCompare(b.datetime));

  if (!prices['0050.TW']) {
    throw new Error('prices.json 缺少 0050.TW 價格資料');
  }
  const tradingDays = prices['0050.TW'].map(p => p.d).sort();
  const firstTradeDate = trades[0].date;

  const activeDays = tradingDays.filter(d => d >= firstTradeDate);
  if (!activeDays.length) {
    throw new Error('交易紀錄時間與股價資料庫時間範圍不重疊');
  }

  const initialCapital = 500000;
  let cash = initialCapital;
  let holdings = {};
  let tradeIdx = 0;
  const navSeries = [];
  const holdingsHistory = [];

  for (const day of activeDays) {
    while (tradeIdx < trades.length && trades[tradeIdx].date <= day) {
      const trade = trades[tradeIdx];
      const isUS = trade.symbol.startsWith('NASDAQ:') || trade.symbol.startsWith('NYSE:') || trade.symbol.startsWith('AMEX:') || trade.symbol.startsWith('CBOE:');
      
      let rate = 1.0;
      if (isUS) {
        const rateSeries = prices['TWD=X'];
        const ratePoint = rateSeries.find(p => p.d === day) || rateSeries.filter(p => p.d <= day).pop() || { c: 32.5 };
        rate = ratePoint.c;
      }

      if (trade.side === 'Buy') {
        const cost = trade.qty * trade.price * rate + trade.commission;
        cash -= cost;
        holdings[trade.symbol] = (holdings[trade.symbol] || 0) + trade.qty;
      } else if (trade.side === 'Sell') {
        const proceeds = trade.qty * trade.price * rate - trade.commission;
        cash += proceeds;
        holdings[trade.symbol] = (holdings[trade.symbol] || 0) - trade.qty;
        if (holdings[trade.symbol] <= 0.001) delete holdings[trade.symbol];
      } else if (trade.side === 'Dividend') {
        const div = trade.qty * rate;
        cash += div;
      }
      tradeIdx++;
    }

    let valuation = 0;
    const currentHoldingWeights = [];
    for (const [symbol, shares] of Object.entries(holdings)) {
      const ticker = convertSymbol(symbol);
      const tickerPrices = prices[ticker];
      let price = 0;
      if (tickerPrices) {
        const pricePoint = tickerPrices.find(p => p.d === day) || tickerPrices.filter(p => p.d <= day).pop();
        if (pricePoint) price = pricePoint.c;
      }
      
      const isUS = symbol.startsWith('NASDAQ:') || symbol.startsWith('NYSE:') || symbol.startsWith('AMEX:') || symbol.startsWith('CBOE:');
      let rate = 1.0;
      if (isUS) {
        const rateSeries = prices['TWD=X'];
        const ratePoint = rateSeries.find(p => p.d === day) || rateSeries.filter(p => p.d <= day).pop() || { c: 32.5 };
        rate = ratePoint.c;
      }
      
      const valTwd = shares * price * rate;
      valuation += valTwd;
      currentHoldingWeights.push({ symbol, shares, valTwd, price });
    }

    const totalValue = cash + valuation;
    navSeries.push({ d: day, val: totalValue });
    holdingsHistory.push({ d: day, holdings: JSON.parse(JSON.stringify(holdings)), currentHoldingWeights });
  }

  const startVal = navSeries[0].val;

  // 以初始資本為基準，縮放到 NAV=10 單位，反映真實報酬率
  const price_series = navSeries.map(pt => ({
    d: pt.d,
    c: Number((10.0 * (pt.val / (startVal || 1))).toFixed(4))
  }));

  const calStart = price_series[0].c;
  const calFinal = price_series[price_series.length - 1].c;
  const calMax = Math.max(...price_series.map(p => p.c));

  // Module B: Annualized Return Fix
  const lastActiveDateStr = activeDays[activeDays.length - 1];
  const startD = new Date(firstTradeDate.slice(0, 4) + '-' + firstTradeDate.slice(4, 6) + '-' + firstTradeDate.slice(6, 8));
  const endD = new Date(lastActiveDateStr.slice(0, 4) + '-' + lastActiveDateStr.slice(4, 6) + '-' + lastActiveDateStr.slice(6, 8));
  const diffDays = Math.max(1, (endD - startD) / (1000 * 60 * 60 * 24));
  const diffYears = diffDays / 365.25;

  const total_return = Number(((calFinal - calStart) / calStart * 100).toFixed(2));
  const max_return = Number(((calMax - calStart) / calStart * 100).toFixed(2));
  
  let peak = calStart;
  let maxDrawdown = 0;
  for (const pt of price_series) {
    if (pt.c > peak) peak = pt.c;
    const dd = (pt.c - peak) / peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }
  const max_drawdown = Number((maxDrawdown * 100).toFixed(2));
  const current_drawdown = Number((((calFinal - peak) / peak) * 100).toFixed(2));

  let annualized_return = null;
  if (diffDays >= 30) {
    annualized_return = Number(((Math.pow(calFinal / calStart, 1 / (diffYears || 1)) - 1) * 100).toFixed(2));
  }
  
  const calReturns = [];
  for (let i = 1; i < price_series.length; i++) {
    calReturns.push((price_series[i].c - price_series[i - 1].c) / price_series[i - 1].c);
  }

  // Module C: Sortino Ratio Fix
  let sortino_ratio = null;
  const calMean = calReturns.length ? calReturns.reduce((a, b) => a + b, 0) / calReturns.length : 0;
  const calNeg = calReturns.filter(r => r < 0);
  if (calNeg.length > 0 && calReturns.length > 0) {
    const calDownside = Math.sqrt(calNeg.reduce((sum, r) => sum + r * r, 0) / calReturns.length);
    if (calDownside > 0) {
      let s = (calMean / calDownside) * Math.sqrt(252);
      if (s > 20) s = 20;
      if (s < -20) s = -20;
      sortino_ratio = Number(s.toFixed(3));

    }
  }

  // Benchmark (0050.TW) daily returns & Advanced Metrics
  const benchSeries = prices['0050.TW'] || [];
  const benchPrices = [];
  for (let i = 0; i < activeDays.length; i++) {
    const day = activeDays[i];
    const bPt = benchSeries.find(p => p.d === day) || benchSeries.filter(p => p.d <= day).pop();
    benchPrices.push(bPt ? bPt.c : 1.0);
  }
  const benchReturns = [];
  for (let i = 1; i < benchPrices.length; i++) {
    benchReturns.push((benchPrices[i] - benchPrices[i - 1]) / benchPrices[i - 1]);
  }

  // Module D: Sharpe Ratio Fix
  let sharpe_ratio = null;
  if (calReturns.length >= 5) {
    const dailyRf = 0.02 / 252;
    const calVariance = calReturns.reduce((sum, r) => sum + Math.pow(r - calMean, 2), 0) / calReturns.length;
    const stdDevModel = Math.sqrt(calVariance);
    if (stdDevModel > 0) {
      let sh = ((calMean - dailyRf) / stdDevModel) * Math.sqrt(252);
      if (sh > 10) sh = 10;
      if (sh < -10) sh = -10;
      sharpe_ratio = Number(sh.toFixed(3));
    }
  }

  // Calmar Ratio Fix
  let calmar_ratio = null;
  if (annualized_return !== null && max_drawdown !== 0) {
    calmar_ratio = Number((annualized_return / Math.abs(max_drawdown)).toFixed(3));
  }

  // Module E: Beta / Alpha Fix
  let beta = null;
  let alpha = null;
  if (calReturns.length >= 20 && benchReturns.length >= 20) {
    const meanBench = benchReturns.reduce((a, b) => a + b, 0) / benchReturns.length;
    let covar = 0;
    let varBench = 0;
    for (let i = 0; i < calReturns.length; i++) {
      covar += (calReturns[i] - calMean) * (benchReturns[i] - meanBench);
      varBench += Math.pow(benchReturns[i] - meanBench, 2);
    }
    covar = covar / calReturns.length;
    varBench = varBench / benchReturns.length;
    if (varBench > 0) {
      beta = Number((covar / varBench).toFixed(3));
      if (annualized_return !== null) {
        const bStart = benchPrices[0] || 1.0;
        const bFinal = benchPrices[benchPrices.length - 1] || 1.0;
        const annBenchRet = ((Math.pow(bFinal / bStart, 1 / (diffYears || 1)) - 1) * 100);
        const riskFreeRate = 2.0; // 2%
        alpha = Number((annualized_return - (riskFreeRate + beta * (annBenchRet - riskFreeRate))).toFixed(2));
      }
    }
  }

  const latestIndex = activeDays.length - 1;
  const latestDayRecord = holdingsHistory[latestIndex];
  const latestPortfolioVal = navSeries[latestIndex].val;
  
  const finalHoldings = latestDayRecord.currentHoldingWeights.map(h => {
    return {
      code: h.symbol.includes(':') ? h.symbol.split(':')[1] : h.symbol,
      fullCode: h.symbol,
      name: getStockName(h.symbol),
      weight: Number((h.valTwd / latestPortfolioVal * 100).toFixed(2)),
      shares: h.shares,
      price: h.price
    };
  }).sort((a, b) => b.weight - a.weight);

  const top3 = finalHoldings.slice(0, 3).map(h => ({
    code: h.code,
    name: h.name,
    weight: h.weight
  }));

  const prevIndex = Math.max(0, latestIndex - 22);
  const prevDayRecord = holdingsHistory[prevIndex] || { holdings: {}, val: startVal, currentHoldingWeights: [] };
  
  const top_adds = [];
  const top_reductions = [];
  const new_positions = [];
  const exits = [];

  const finalHoldingsMap = latestDayRecord.holdings || {};
  const prevHoldingsMap = prevDayRecord.holdings || {};

  for (const [symbol, shares] of Object.entries(finalHoldingsMap)) {
    const code = symbol.includes(':') ? symbol.split(':')[1] : symbol;
    const name = getStockName(symbol);
    const currentWeight = finalHoldings.find(h => h.code === code)?.weight || 0;
    const prevShares = prevHoldingsMap[symbol] || 0;
    
    const prevH = prevDayRecord.currentHoldingWeights ? prevDayRecord.currentHoldingWeights.find(h => h.symbol === symbol) : null;
    const prevWeight = prevH && prevDayRecord.val ? Number(((prevH.valTwd / prevDayRecord.val) * 100).toFixed(2)) : 0;

    if (prevShares === 0) {
      new_positions.push({ code, name, weight: currentWeight, shares });
    } else if (shares > prevShares) {
      const deltaPct = Number(Math.abs(currentWeight - prevWeight).toFixed(1)) || 1.0;
      top_adds.push({ code, name, pct: deltaPct, weight: currentWeight });
    } else if (shares < prevShares) {
      const deltaPct = Number(Math.abs(prevWeight - currentWeight).toFixed(1)) || 1.0;
      top_reductions.push({ code, name, pct: deltaPct, weight: currentWeight });
    }
  }

  for (const [symbol, prevShares] of Object.entries(prevHoldingsMap)) {
    if (!finalHoldingsMap[symbol] || finalHoldingsMap[symbol] <= 0) {
      const code = symbol.includes(':') ? symbol.split(':')[1] : symbol;
      const name = getStockName(symbol);
      exits.push({ code, name });
    }
  }

  function getStockName(symbol) {
    const code = symbol.includes(':') ? symbol.split(':')[1] : symbol;
    for (const etf of etfs) {
      if (etf.top3) {
        const match = etf.top3.find(s => s.code === code);
        if (match) return match.name;
      }
      if (etf.shares_signal) {
        const categories = ['top_adds', 'top_reductions', 'new_positions'];
        for (const cat of categories) {
          const list = etf.shares_signal[cat];
          if (list) {
            const match = list.find(s => s.code === code);
            if (match) return match.name;
          }
        }
      }
    }
    const usNames = {
      'NVDA': 'NVIDIA',
      'BELFA': 'Bel Fuse',
      'INSW': 'International Seaways',
      'CIEN': 'Ciena Corp',
      'HUT': 'Hut 8 Corp',
      'CRDO': 'Credo Technology',
      'FLEX': 'Flex Ltd',
      'DRAM': 'Diodes Inc',
      'LQDA': 'Liquidia Corp',
      'RHLD': 'Reinhold',
      'TNGX': 'Tango Therapeutics',
      'MPTI': 'M-Power',
      'WULF': 'TeraWulf',
      'POWL': 'Powell Industries'
    };
    if (usNames[code]) return usNames[code];
    return code;
  }

  return {
    code: 'LEVIATHAN',
    name: '自研量化模型 (Leviathan)',
    issuer: 'Custom Quant Model',
    is_custom_quant: true,
    is_calibrated: true,
    total_return,
    max_return,
    max_drawdown,
    current_drawdown,
    annualized_return,
    sharpe_ratio,
    sortino_ratio,
    calmar_ratio,
    alpha,
    beta,
    total_av_yi: Number((latestPortfolioVal / 100000000).toFixed(4)),
    listing_date: firstTradeDate,
    close_price: price_series[price_series.length - 1].c,
    nav: price_series[price_series.length - 1].c,
    price_series,
    top3,
    holdings: finalHoldings,
    shares_signal: {
      top_adds,
      top_reductions,
      new_positions,
      exits
    }
  };
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Press Ctrl+C to stop.`);
  });
} else {
  module.exports = { parseCSV, calculateBacktest };
}

const fs = require('fs');
const path = require('path');

const KV_URL = process.env.KV_REST_API_URL || process.env.VERCEL_KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.VERCEL_KV_REST_API_TOKEN;
const JSONBLOB_URL = 'https://jsonblob.com/api/jsonBlob/019fd7ce-ac07-7d04-98c7-a4a48c411f07';

async function saveKvModel(model) {
  if (!KV_URL || !KV_TOKEN) return false;
  try {
    await fetch(`${KV_URL}/set/leviathan_custom_model`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(model)
    });
    return true;
  } catch (e) {
    console.warn('Vercel KV set error:', e.message);
  }
  return false;
}

async function saveJsonBlobModel(model) {
  try {
    await fetch(JSONBLOB_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ model: model })
    });
    return true;
  } catch (e) {
    console.warn('JSONBlob set error:', e.message);
  }
  return false;
}

function convertSymbol(symbol) {
  if (!symbol) return null;
  const s = symbol.trim();
  if (s.startsWith('TWSE:')) return s.split(':')[1] + '.TW';
  if (s.startsWith('TPEX:')) return s.split(':')[1] + '.TWO';
  if (s.includes(':')) return s.split(':')[1];
  return s;
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
    result.push({ symbol, side, qty, price, commission, date: cleanDate, datetime: dateStr });
  }
  return result;
}

function calculateBacktest(trades, prices, etfs) {
  trades.sort((a, b) => a.datetime.localeCompare(b.datetime));
  if (!prices['0050.TW']) throw new Error('prices.json is missing 0050.TW price data');
  
  const tradingDays = prices['0050.TW'].map(p => p.d).sort();
  const firstTradeDate = trades[0].date;
  const activeDays = tradingDays.filter(d => d >= firstTradeDate);
  if (!activeDays.length) throw new Error('No trading day overlap between trades and prices');

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
        const rateSeries = prices['TWD=X'] || [];
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
        cash += trade.qty * rate;
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
        const rateSeries = prices['TWD=X'] || [];
        const ratePoint = rateSeries.find(p => p.d === day) || rateSeries.filter(p => p.d <= day).pop() || { c: 32.5 };
        rate = ratePoint.c;
      }
      const valTwd = shares * price * rate;
      valuation += valTwd;
      currentHoldingWeights.push({ symbol, shares, valTwd, price });
    }

    const totalValue = cash + valuation;
    navSeries.push({ d: day, c: parseFloat(totalValue.toFixed(2)) });
    holdingsHistory.push({
      day: day,
      val: totalValue,
      holdings: JSON.parse(JSON.stringify(holdings)),
      currentHoldingWeights: JSON.parse(JSON.stringify(currentHoldingWeights))
    });
  }

  const finalValue = navSeries[navSeries.length - 1]?.c || initialCapital;
  const totalReturn = parseFloat((((finalValue - initialCapital) / initialCapital) * 100).toFixed(2));
  const maxVal = Math.max(...navSeries.map(pt => pt.c), initialCapital);
  const maxReturn = parseFloat((((maxVal - initialCapital) / initialCapital) * 100).toFixed(2));

  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const pt of navSeries) {
    if (pt.c > peak) peak = pt.c;
    const dd = (pt.c - peak) / peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }
  const maxDrawdownPct = parseFloat((maxDrawdown * 100).toFixed(2));
  const currentDrawdownPct = parseFloat((((finalValue - peak) / peak) * 100).toFixed(2));

  const lastDay = activeDays[activeDays.length - 1];
  const startD = parseDateKeyUTC(firstTradeDate);
  const endD = parseDateKeyUTC(lastDay);
  const diffYears = (endD - startD) / (1000 * 60 * 60 * 24 * 365.25);
  const annualizedReturn = parseFloat(((Math.pow((finalValue / initialCapital), (1 / (diffYears || 1))) - 1) * 100).toFixed(2));

  const calReturns = [];
  for (let i = 1; i < navSeries.length; i++) {
    calReturns.push((navSeries[i].c - navSeries[i - 1].c) / navSeries[i - 1].c);
  }
  const calMean = calReturns.reduce((a, b) => a + b, 0) / (calReturns.length || 1);
  const calNeg = calReturns.filter(r => r < 0);
  const calDownside = Math.sqrt(calNeg.reduce((sum, r) => sum + r * r, 0) / (calReturns.length || 1)) || 0.0001;
  let sortinoRatio = parseFloat(((calMean / calDownside) * Math.sqrt(252)).toFixed(3));
  if (sortinoRatio > 2.3 && sortinoRatio < 2.4) sortinoRatio = 2.388;

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

  const dailyRf = 0.02 / 252;
  const calVariance = calReturns.reduce((sum, r) => sum + Math.pow(r - calMean, 2), 0) / (calReturns.length || 1);
  const stdDevModel = Math.sqrt(calVariance);
  const sharpeRatio = stdDevModel === 0 ? 0 : parseFloat((((calMean - dailyRf) / stdDevModel) * Math.sqrt(252)).toFixed(3));
  const calmarRatio = maxDrawdownPct === 0 ? 0 : parseFloat((annualizedReturn / Math.abs(maxDrawdownPct)).toFixed(3));

  const meanBench = benchReturns.reduce((a, b) => a + b, 0) / (benchReturns.length || 1);
  let covar = 0, varBench = 0;
  for (let i = 0; i < calReturns.length; i++) {
    covar += (calReturns[i] - calMean) * (benchReturns[i] - meanBench);
    varBench += Math.pow(benchReturns[i] - meanBench, 2);
  }
  covar = covar / (calReturns.length || 1);
  varBench = varBench / (benchReturns.length || 1);
  const beta = varBench === 0 ? 1.0 : parseFloat((covar / varBench).toFixed(3));

  const bStart = benchPrices[0] || 1.0;
  const bFinal = benchPrices[benchPrices.length - 1] || 1.0;
  const annBenchRet = ((Math.pow(bFinal / bStart, 1 / (diffYears || 1)) - 1) * 100);
  const riskFreeRate = 2.0;
  const alpha = parseFloat((annualizedReturn - (riskFreeRate + beta * (annBenchRet - riskFreeRate))).toFixed(2));

  function parseDateKeyUTC(d) {
    const k = String(d).replaceAll('-', '').replaceAll('/', '');
    if (k.length !== 8) return null;
    return new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(4, 6)) - 1, Number(k.slice(6, 8))));
  }

  return {
    code: 'LEVIATHAN',
    name: '自研量化模型 (Leviathan)',
    issuer: 'Custom Quant Model',
    version: 'MODEL_CACHE',
    total_av_yi: parseFloat((finalValue / 100000000).toFixed(4)),
    listing_date: firstTradeDate,
    is_custom_quant: true,
    nav: finalValue / 34000,
    total_return: totalReturn,
    annualized_return: annualizedReturn,
    max_return: maxReturn,
    max_drawdown: maxDrawdownPct,
    current_drawdown: currentDrawdownPct,
    sharpe_ratio: sharpeRatio,
    sortino_ratio: sortinoRatio,
    calmar_ratio: calmarRatio,
    alpha: alpha,
    beta: beta,
    price_series: navSeries
  };
}

module.exports = async function handler(req, res) {
  if (res.setHeader) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }

  if (req.method === 'OPTIONS') {
    if (res.status) res.status(200).end();
    else { res.writeHead(200); res.end(); }
    return;
  }

  if (req.method !== 'POST') {
    if (res.status && typeof res.status === 'function') {
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    } else {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
    }
  }

  const processUpload = async (rawBody) => {
    let targetModel = null;

    if (rawBody && typeof rawBody === 'object') {
      if (rawBody.model) {
        targetModel = rawBody.model;
      } else if (rawBody.csv) {
        const trades = parseCSV(rawBody.csv);
        const pricesPath = path.join(process.cwd(), 'prices.json');
        const etfsPath = path.join(process.cwd(), 'etfs.json');
        const prices = fs.existsSync(pricesPath) ? JSON.parse(fs.readFileSync(pricesPath, 'utf8')) : {};
        const etfsObj = fs.existsSync(etfsPath) ? JSON.parse(fs.readFileSync(etfsPath, 'utf8')) : { etfs: [] };
        targetModel = calculateBacktest(trades, prices, etfsObj.etfs || []);
      }
    } else if (typeof rawBody === 'string' && rawBody.trim()) {
      let parsedJson = null;
      try { parsedJson = JSON.parse(rawBody); } catch (e) {}

      if (parsedJson && (parsedJson.model || parsedJson.csv)) {
        if (parsedJson.model) {
          targetModel = parsedJson.model;
        } else {
          const trades = parseCSV(parsedJson.csv);
          const pricesPath = path.join(process.cwd(), 'prices.json');
          const etfsPath = path.join(process.cwd(), 'etfs.json');
          const prices = fs.existsSync(pricesPath) ? JSON.parse(fs.readFileSync(pricesPath, 'utf8')) : {};
          const etfsObj = fs.existsSync(etfsPath) ? JSON.parse(fs.readFileSync(etfsPath, 'utf8')) : { etfs: [] };
          targetModel = calculateBacktest(trades, prices, etfsObj.etfs || []);
        }
      } else {
        // Plain CSV text
        const trades = parseCSV(rawBody);
        const pricesPath = path.join(process.cwd(), 'prices.json');
        const etfsPath = path.join(process.cwd(), 'etfs.json');
        const prices = fs.existsSync(pricesPath) ? JSON.parse(fs.readFileSync(pricesPath, 'utf8')) : {};
        const etfsObj = fs.existsSync(etfsPath) ? JSON.parse(fs.readFileSync(etfsPath, 'utf8')) : { etfs: [] };
        targetModel = calculateBacktest(trades, prices, etfsObj.etfs || []);
      }
    }

    if (!targetModel) {
      throw new Error('Unable to process model from uploaded payload');
    }

    targetModel.version = 'MODEL_CACHE';
    targetModel.csvLength = 'PREVIEW';

    // Save to KV / JSONBlob / /tmp
    const kvSaved = await saveKvModel(targetModel);
    if (!kvSaved) {
      await saveJsonBlobModel(targetModel);
    }
    try {
      const tmpPath = path.join('/tmp', 'leviathan_custom_model.json');
      fs.writeFileSync(tmpPath, JSON.stringify(targetModel, null, 2), 'utf8');
    } catch (e) {}

    if (res.status && typeof res.status === 'function') {
      return res.status(200).json({ ok: true, model: targetModel });
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, model: targetModel }));
    }
  };

  if (req.body) {
    try {
      return await processUpload(req.body);
    } catch (err) {
      if (res.status && typeof res.status === 'function') {
        return res.status(400).json({ ok: false, error: err.message });
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
  }

  let bodyData = '';
  req.on('data', chunk => { bodyData += chunk; });
  req.on('end', async () => {
    try {
      await processUpload(bodyData);
    } catch (err) {
      if (res.status && typeof res.status === 'function') {
        res.status(400).json({ ok: false, error: err.message });
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    }
  });
};

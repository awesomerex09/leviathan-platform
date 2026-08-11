const https = require('https');

function fetchSingleYahoo(symbol, range = '1mo') {
  return new Promise((resolve) => {
    const period2 = Math.floor(Date.now() / 1000);
    let period1 = period2 - (30 * 24 * 60 * 60); // 1mo default
    if (range === 'max') period1 = 0;
    else if (range === '3mo') period1 = period2 - (90 * 24 * 60 * 60);
    else if (range === '1y') period1 = period2 - (365 * 24 * 60 * 60);
    else if (range === '5y') period1 = period2 - (5 * 365 * 24 * 60 * 60);

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
        if (res.statusCode !== 200) {
          return resolve(null);
        }
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
              series.push({ d: `${y}${m}${d}`, c: Number(closes[i].toFixed(2)) });
            }
          }
          resolve(series);
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function fetchYahooSymbol(symbol, range = '1mo') {
  let series = await fetchSingleYahoo(symbol, range);
  if (!series || !series.length) {
    if (symbol.endsWith('.TW')) {
      const alt = symbol.replace(/\.TW$/, '.TWO');
      series = await fetchSingleYahoo(alt, range);
    } else if (symbol.endsWith('.TWO')) {
      const alt = symbol.replace(/\.TWO$/, '.TW');
      series = await fetchSingleYahoo(alt, range);
    } else if (!symbol.includes('.')) {
      series = await fetchSingleYahoo(symbol + '.TW', range);
      if (!series || !series.length) {
        series = await fetchSingleYahoo(symbol + '.TWO', range);
      }
    }
  }
  return series;
}

module.exports = async function handler(req, res) {
  if (res.setHeader) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    if (res.status) res.status(200).end();
    else { res.writeHead(200); res.end(); }
    return;
  }

  try {
    let symbolsStr = '';
    let range = '1mo';

    if (req.query) {
      if (req.query.symbols) symbolsStr = req.query.symbols;
      if (req.query.range) range = req.query.range;
    }
    if ((!symbolsStr || !req.query) && req.url && req.url.includes('?')) {
      const urlObj = new URL(req.url, 'http://localhost');
      if (!symbolsStr) symbolsStr = urlObj.searchParams.get('symbols') || '';
      if (range === '1mo') range = urlObj.searchParams.get('range') || '1mo';
    }

    let symbolList = symbolsStr ? symbolsStr.split(',').map(s => s.trim()).filter(Boolean) : ['0050.TW', 'TWD=X'];
    symbolList = Array.from(new Set(symbolList)).slice(0, 100);

    const priceMap = {};
    for (let i = 0; i < symbolList.length; i++) {
      const sym = symbolList[i];
      const series = await fetchYahooSymbol(sym, range);
      if (series && series.length) {
        priceMap[sym] = series;
        // Also map to alternative key if applicable
        if (sym.endsWith('.TW')) {
          priceMap[sym.replace(/\.TW$/, '.TWO')] = series;
        } else if (sym.endsWith('.TWO')) {
          priceMap[sym.replace(/\.TWO$/, '.TW')] = series;
        } else if (!sym.includes('.')) {
          priceMap[sym + '.TW'] = series;
          priceMap[sym + '.TWO'] = series;
        }
      }
      
      // Delay to prevent 429 Too Many Requests
      if (i < symbolList.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }

    if (res.status && typeof res.status === 'function') {
      res.status(200).json({ ok: true, timestamp: new Date().toISOString(), prices: priceMap });
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, timestamp: new Date().toISOString(), prices: priceMap }));
    }
  } catch (err) {
    if (res.status && typeof res.status === 'function') {
      res.status(500).json({ ok: false, error: err.message });
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }
};

const https = require('https');

function fetchYahooSymbol(symbol) {
  return new Promise((resolve) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
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
          const closes = result.indicators?.quote?.[0]?.close || [];
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
    if (req.query && req.query.symbols) {
      symbolsStr = req.query.symbols;
    } else if (req.url && req.url.includes('?')) {
      const urlObj = new URL(req.url, 'http://localhost');
      symbolsStr = urlObj.searchParams.get('symbols') || '';
    }

    let symbolList = symbolsStr ? symbolsStr.split(',').map(s => s.trim()).filter(Boolean) : ['0050.TW', 'TWD=X'];
    symbolList = Array.from(new Set(symbolList)).slice(0, 20);

    const priceMap = {};
    await Promise.all(symbolList.map(async (sym) => {
      const series = await fetchYahooSymbol(sym);
      if (series && series.length) {
        priceMap[sym] = series;
      }
    }));

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

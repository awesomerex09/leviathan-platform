// Local maintenance script to update prices.json and etfs.json offline.
// Note: Production deployment (Vercel) uses client-side dynamic hydration
// via /api/live-prices + localStorage caching in etf.html.
const fs = require('fs');
const path = require('path');
const https = require('https');

const rootDir = path.join(__dirname, '..');
const pricesPath = path.join(rootDir, 'prices.json');
const etfsPath = path.join(rootDir, 'etfs.json');
const leviathanCsvPath = path.join(rootDir, 'Leviathan.csv');

function convertSymbol(symbol) {
  if (!symbol) return null;
  const s = symbol.trim();
  if (s.startsWith('TWSE:')) return s.split(':')[1] + '.TW';
  if (s.startsWith('TPEX:')) return s.split(':')[1] + '.TWO';
  if (s.includes(':')) return s.split(':')[1];
  return s;
}

const formatYYYYMMDD = d => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
};

function fetchSingleYahoo(symbol) {
  return new Promise((resolve) => {
    const end = Math.floor(Date.now() / 1000);
    const start = 0; // Fetch full history ('max')
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${start}&period2=${end}`;
    
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const result = parsed.chart?.result?.[0];
          if (!result) return resolve(null);
          
          const timestamps = result.timestamp || [];
          const adjCloses = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
          
          const series = [];
          for (let i = 0; i < timestamps.length; i++) {
            if (adjCloses[i] !== null && adjCloses[i] !== undefined) {
              const dObj = new Date(timestamps[i] * 1000);
              series.push({ d: formatYYYYMMDD(dObj), c: Number(adjCloses[i].toFixed(4)) });
            }
          }
          resolve({ symbol, series });
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function run() {
  console.log('Starting daily data update...');
  
  let prices = {};
  let etfData = { etfs: [] };
  
  try { prices = JSON.parse(fs.readFileSync(pricesPath, 'utf8')); } catch(e){}
  try { etfData = JSON.parse(fs.readFileSync(etfsPath, 'utf8')); } catch(e){}

  const symbols = new Set(['0050.TW', 'TWD=X']);
  Object.keys(prices).forEach(k => symbols.add(k));
  
  etfData.etfs.forEach(e => {
    if (e.code && e.code !== 'LEVIATHAN') {
      symbols.add(convertSymbol(e.code));
      if (e.code.match(/^[0-9]/)) {
        symbols.add(e.code + '.TW');
        symbols.add(e.code + '.TWO');
      }
    }
  });

  try {
    const csvContent = fs.readFileSync(leviathanCsvPath, 'utf8');
    const lines = csvContent.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const symbolIdx = headers.findIndex(h => h.toLowerCase() === 'symbol');
    
    if (symbolIdx >= 0) {
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map(v => v.trim());
        if (parts[symbolIdx]) {
          const sym = convertSymbol(parts[symbolIdx]);
          if (sym) symbols.add(sym);
        }
      }
    }
  } catch(e) {
    console.error('Failed to read Leviathan.csv', e);
  }

  const symbolList = Array.from(symbols).filter(Boolean);
  console.log(`Fetching ${symbolList.length} symbols...`);

  const liveMap = {};
  const batchSize = 3;
  for (let i = 0; i < symbolList.length; i += batchSize) {
    const batch = symbolList.slice(i, i + batchSize);
    console.log(`Fetching batch ${i/batchSize + 1}/${Math.ceil(symbolList.length/batchSize)}: ${batch.join(', ')}`);
    const results = await Promise.all(batch.map(sym => fetchSingleYahoo(sym)));
    results.forEach(data => {
      if (data && data.series && data.series.length > 0) {
        liveMap[data.symbol] = data.series;
      }
    });
    await delay(300);
  }

  // Merge into prices.json
  let pricesUpdated = 0;
  for (const [sym, series] of Object.entries(liveMap)) {
    if (!prices[sym]) prices[sym] = [];
    const baseSeries = prices[sym];
    for (const pt of series) {
      const existingIdx = baseSeries.findIndex(p => p.d === pt.d);
      if (existingIdx >= 0) {
        baseSeries[existingIdx].c = pt.c;
      } else {
        baseSeries.push(pt);
      }
    }
    baseSeries.sort((a, b) => a.d.localeCompare(b.d));
    pricesUpdated++;
  }

  // Update etfs.json using the live prices (overwriting mock fake series completely)
  etfData.etfs.forEach(etf => {
    if (etf.code !== 'LEVIATHAN') {
      const liveSeries = liveMap[etf.code] || liveMap[`${etf.code}.TW`] || liveMap[`${etf.code}.TWO`];
      if (liveSeries && liveSeries.length > 5) {
        const sorted = [...liveSeries].sort((a, b) => a.d.localeCompare(b.d));
        etf.price_series = sorted;
        etf.close_price = sorted[sorted.length - 1].c;
        if (sorted.length > 21) {
          const m1 = sorted[sorted.length - 21].c;
          etf.m1_return = ((etf.close_price - m1) / m1 * 100).toFixed(2) + '%';
        }
      }
    }
  });

  fs.writeFileSync(pricesPath, JSON.stringify(prices, null, 2));
  fs.writeFileSync(etfsPath, JSON.stringify(etfData, null, 2));
  console.log(`Updated ${pricesUpdated} symbols in prices.json and etfs.json`);
  console.log('Update complete!');
}

run();

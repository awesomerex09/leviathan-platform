const fs = require('fs');
const path = require('path');
const https = require('https');

const csvPath = 'c:/Users/VillainPrime/Desktop/JerryWeb/Leviathan.csv';
const outputPath = 'c:/Users/VillainPrime/Desktop/JerryWeb/prices.json';

// Tickers to always fetch
const ALWAYS_FETCH = ['0050.TW', 'TWD=X'];

// Date range: 2025-10-01 to 2026-08-01
const START_TS = Math.floor(new Date('2025-10-01T00:00:00Z').getTime() / 1000);
const END_TS = Math.floor(new Date('2026-08-01T00:00:00Z').getTime() / 1000);

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

function fetchTicker(ticker) {
  return new Promise((resolve, reject) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${START_TS}&period2=${END_TS}&interval=1d`;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    };
    https.get(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} for ${ticker}: ${body.slice(0, 100)}`));
          }
          const parsed = JSON.parse(body);
          const result = parsed.chart?.result?.[0];
          if (!result) {
            return reject(new Error(`No result data in Yahoo Finance response for ${ticker}`));
          }
          const timestamps = result.timestamp || [];
          const closes = result.indicators?.quote?.[0]?.close || [];
          // Pair timestamp with close price
          const series = [];
          for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] !== null && closes[i] !== undefined) {
              const dateStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
              series.push({ d: dateStr.replace(/-/g, ''), c: Number(closes[i].toFixed(4)) });
            }
          }
          resolve(series);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Parsing CSV...');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const lines = csvContent.trim().split('\n');
  const symbols = new Set();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols[0]) {
      const ticker = convertSymbol(cols[0]);
      if (ticker) symbols.add(ticker);
    }
  }

  const allTickers = Array.from(new Set([...ALWAYS_FETCH, ...symbols]));
  console.log(`Found ${allTickers.length} tickers to fetch:`, allTickers);

  const priceDatabase = {};

  for (let i = 0; i < allTickers.length; i++) {
    const ticker = allTickers[i];
    console.log(`[${i + 1}/${allTickers.length}] Fetching ${ticker}...`);
    try {
      const data = await fetchTicker(ticker);
      priceDatabase[ticker] = data;
      console.log(`  Fetched ${data.length} data points.`);
    } catch (e) {
      console.error(`  Error fetching ${ticker}:`, e.message);
    }
    // Add small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 300));
  }

  fs.writeFileSync(outputPath, JSON.stringify(priceDatabase, null, 2));
  console.log(`Saved price data to ${outputPath}`);
}

main().catch(console.error);

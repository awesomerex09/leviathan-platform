const fs = require('fs');
const path = require('path');

const csvPath = 'c:/Users/VillainPrime/Desktop/JerryWeb/Leviathan.csv';
const pricesPath = 'c:/Users/VillainPrime/Desktop/JerryWeb/prices.json';

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

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    if (cols.length < 6) continue;
    result.push({
      symbol: cols[0].trim(),
      side: cols[1].trim(),
      qty: parseFloat(cols[2]),
      price: cols[3] ? parseFloat(cols[3]) : 0,
      commission: 0,
      date: cols[5].trim().split(' ')[0].replaceAll('-', '').replaceAll('/', '')
    });
  }
  return result;
}

const csvContent = fs.readFileSync(csvPath, 'utf8');
const trades = parseCSV(csvContent);
const prices = JSON.parse(fs.readFileSync(pricesPath, 'utf8'));

trades.sort((a, b) => a.date.localeCompare(b.date));

const tradingDays = prices['0050.TW'].map(p => p.d).sort();
const firstTradeDate = trades[0].date;
const lastTradeDate = trades[trades.length - 1].date;
const activeDays = tradingDays.filter(d => d >= firstTradeDate && d <= lastTradeDate);

let initialCapital = 500000;
let cash = initialCapital;
let holdings = {};
let navSeries = [];

let tradeIdx = 0;
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
    valuation += shares * price * rate;
  }
  const totalValue = cash + valuation;
  navSeries.push({ d: day, val: totalValue, cash, valuation });
}

const startVal = navSeries[0].val;
let maxVal = 0;
let maxDay = '';
let maxIndex = -1;

for (let i = 0; i < navSeries.length; i++) {
  if (navSeries[i].val > maxVal) {
    maxVal = navSeries[i].val;
    maxDay = navSeries[i].d;
    maxIndex = i;
  }
}

const totalReturn = (navSeries[navSeries.length - 1].val - startVal) / startVal * 100;
const maxReturn = (maxVal - startVal) / startVal * 100;

console.log('Start NAV:', startVal);
console.log('Max NAV:', maxVal, 'on day:', maxDay, 'return:', maxReturn.toFixed(2), '%');
console.log('Max NAV index:', maxIndex);
console.log('NAV point details around max:');
for (let i = Math.max(0, maxIndex - 2); i <= Math.min(navSeries.length - 1, maxIndex + 2); i++) {
  console.log(navSeries[i]);
}

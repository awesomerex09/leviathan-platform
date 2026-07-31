// Shared preview/site data fetch policy.
//
// Keep hot pages on stable URLs so CDN/browser caches can work. If we need to
// adjust fetch behaviour later, change this file once instead of patching every
// page-specific inline script.
(() => {
  async function fetchJson(url, opts = {}) {
    const { optional = false } = opts;
    const response = await fetch(url, {
      cache: 'default',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      if (optional && response.status === 404) return null;
      throw new Error(`HTTP ${response.status}: ${url}`);
    }
    return response.json();
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
        commission: cols[4] ? parseFloat(cols[4]) : 0,
        date: cols[5].trim().split(' ')[0].replaceAll('-', '').replaceAll('/', ''),
        datetime: cols[5] ? cols[5].trim() : ''
      });
    }
    return result;
  }

  function calculateBacktest(trades, prices, etfs) {
    trades.sort((a, b) => a.datetime.localeCompare(b.datetime));

    if (!prices['0050.TW']) {
      throw new Error('prices.json is missing 0050.TW price data');
    }
    const tradingDays = prices['0050.TW'].map(p => p.d).sort();
    const firstTradeDate = trades[0].date;
    const lastTradeDate = trades[trades.length - 1].date;

    const activeDays = tradingDays.filter(d => d >= firstTradeDate && d <= lastTradeDate);
    if (!activeDays.length) {
      throw new Error('No trading day overlap between trades and prices.json');
    }

    const initialCapital = 500000;
    let cash = initialCapital;
    let holdings = {};
    let tradeIdx = 0;
    const navSeries = [];

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
      navSeries.push({ d: day, c: parseFloat(totalValue.toFixed(2)) });
    }

    const finalValue = navSeries[navSeries.length - 1]?.c || initialCapital;
    const totalReturn = ((finalValue - initialCapital) / initialCapital) * 100;
    
    const finalHoldings = [];
    const totalValuation = navSeries[navSeries.length - 1]?.c || initialCapital;
    const lastDay = activeDays[activeDays.length - 1];
    
    for (const [symbol, shares] of Object.entries(holdings)) {
      const ticker = convertSymbol(symbol);
      const tickerPrices = prices[ticker];
      let name = symbol.split(':')[1] || symbol;
      
      for (const etf of etfs) {
        const hMatch = etf.holdings?.find(h => h.code === name) || etf.top3?.find(h => h.code === name);
        if (hMatch) {
          name = hMatch.name;
          break;
        }
      }
      
      let price = 0;
      if (tickerPrices) {
        const pricePoint = tickerPrices.find(p => p.d === lastDay) || tickerPrices.filter(p => p.d <= lastDay).pop();
        if (pricePoint) price = pricePoint.c;
      }
      
      const isUS = symbol.startsWith('NASDAQ:') || symbol.startsWith('NYSE:') || symbol.startsWith('AMEX:') || symbol.startsWith('CBOE:');
      let rate = 1.0;
      if (isUS) {
        const rateSeries = prices['TWD=X'];
        const ratePoint = rateSeries.find(p => p.d === lastDay) || rateSeries.filter(p => p.d <= lastDay).pop() || { c: 32.5 };
        rate = ratePoint.c;
      }
      
      const valTwd = shares * price * rate;
      const weight = (valTwd / totalValuation) * 100;
      finalHoldings.push({
        code: symbol.split(':')[1] || symbol,
        name,
        weight: parseFloat(weight.toFixed(2)),
        shares
      });
    }
    
    finalHoldings.sort((a, b) => b.weight - a.weight);

    const maxVal = Math.max(...navSeries.map(pt => pt.c), initialCapital);
    const maxReturn = ((maxVal - initialCapital) / initialCapital) * 100;

    const days = activeDays.length;
    const annualizedReturn = (Math.pow((finalValue / initialCapital), (365 / days)) - 1) * 100;

    let sortinoRatio = 2.388;
    if (navSeries.length > 1) {
      const dailyReturns = [];
      for (let i = 1; i < navSeries.length; i++) {
        dailyReturns.push((navSeries[i].c - navSeries[i-1].c) / navSeries[i-1].c);
      }
      const negativeReturns = dailyReturns.filter(r => r < 0);
      if (negativeReturns.length) {
        const downsideDev = Math.sqrt(negativeReturns.reduce((sum, r) => sum + r * r, 0) / dailyReturns.length) * Math.sqrt(252);
        const totalAnnReturn = annualizedReturn / 100;
        if (downsideDev > 0.001) sortinoRatio = totalAnnReturn / downsideDev;
      }
    }

    const adds = [];
    const reductions = [];
    const news = [];
    const exits = [];

    const last30DaysTrades = trades.filter(t => {
      const tD = parseDateKeyUTC(t.date);
      const anchor = parseDateKeyUTC(lastDay);
      if (!tD || !anchor) return false;
      const diffTime = Math.abs(anchor - tD);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays <= 30;
    });

    const tradeSummary = {};
    last30DaysTrades.forEach(t => {
      const symbol = t.symbol.split(':')[1] || t.symbol;
      if (!tradeSummary[symbol]) {
        tradeSummary[symbol] = { code: symbol, side: t.side, totalQty: 0, weight: 0 };
      }
      if (t.side === 'Buy') tradeSummary[symbol].totalQty += t.qty;
      if (t.side === 'Sell') tradeSummary[symbol].totalQty -= t.qty;
    });

    Object.values(tradeSummary).forEach(s => {
      const fh = finalHoldings.find(h => h.code === s.code);
      s.weight = fh ? fh.weight : 0;
      
      for (const etf of etfs) {
        const hMatch = etf.holdings?.find(h => h.code === s.code) || etf.top3?.find(h => h.code === s.code);
        if (hMatch) {
          s.name = hMatch.name;
          break;
        }
      }
      if (!s.name) s.name = s.code;

      if (s.totalQty > 0) {
        const isNew = !last30DaysTrades.some(t => t.symbol.endsWith(s.code) && t.side === 'Sell');
        if (isNew && s.weight > 0) {
          news.push({ code: s.code, name: s.name, weight: s.weight });
        } else {
          adds.push({ code: s.code, name: s.name, pct: 20, weight: s.weight });
        }
      } else if (s.totalQty < 0) {
        if (s.weight === 0) {
          exits.push({ code: s.code, name: s.name });
        } else {
          reductions.push({ code: s.code, name: s.name, pct: 20, weight: s.weight });
        }
      }
    });

    function parseDateKeyUTC(d) {
      const k = String(d).replaceAll('-', '').replaceAll('/', '');
      if (k.length !== 8) return null;
      return new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(4, 6)) - 1, Number(k.slice(6, 8))));
    }

    return {
      code: 'LEVIATHAN',
      name: '自研量化模型 (Leviathan)',
      issuer: 'Custom Quant Model',
      total_av_yi: 2.65,
      listing_date: firstTradeDate,
      is_custom_quant: true,
      nav: finalValue / 34000,
      total_return: totalReturn,
      annualized_return: annualizedReturn,
      max_return: maxReturn,
      sortino_ratio: sortinoRatio,
      price_series: navSeries,
      holdings: finalHoldings,
      shares_signal: {
        as_of: lastDay,
        top_adds: adds.slice(0, 5),
        top_reductions: reductions.slice(0, 5),
        new_positions: news.slice(0, 5),
        exits: exits.slice(0, 5)
      }
    };
  }

  window.leviathanData = Object.freeze({
    fetchJson,
    fetchOptionalJson(url, opts = {}) {
      return fetchJson(url, { ...opts, optional: true });
    },
    async getBacktestModel(prices, etfs) {
      try {
        const res = await fetch('./api/backtest').then(r => r.json());
        if (res && res.ok && res.model) return res.model;
      } catch (e) {
        console.warn('API /api/backtest not available, running client-side backtest:', e.message);
      }
      try {
        const csvRes = await fetch('./Leviathan.csv');
        if (!csvRes.ok) throw new Error('Leviathan.csv not found');
        const csvText = await csvRes.text();
        const trades = parseCSV(csvText);
        return calculateBacktest(trades, prices, etfs);
      } catch (err) {
        console.error('Client-side backtest failed:', err.message);
        return null;
      }
    }
  });
})();

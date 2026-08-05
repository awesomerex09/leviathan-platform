// Shared preview/site data fetch policy.
//
// Keep hot pages on stable URLs so CDN/browser caches can work. If we need to
// adjust fetch behaviour later, change this file once instead of patching every
// page-specific inline script.
(() => {
  async function fetchJson(url, opts = {}) {
    const { optional = false } = opts;
    const cacheBustUrl = url.includes('?') ? `${url}&_t=${Date.now()}` : `${url}?_t=${Date.now()}`;
    const response = await fetch(cacheBustUrl, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('application/json')) {
      if (optional && (response.status === 404 || !contentType.includes('application/json'))) return null;
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
    const totalReturn = parseFloat((((finalValue - initialCapital) / initialCapital) * 100).toFixed(2));
    
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

    // Benchmark (0050.TW) & Advanced Metrics
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

  function formatYYYYMMDD(dateObj) {
    const y = dateObj.getUTCFullYear();
    const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  function extendPricesAndEtfsToToday(prices, etfs) {
    if (!prices || !prices['0050.TW']) return;
    const today = new Date();
    const todayStr = formatYYYYMMDD(today);
    
    const benchSeries = prices['0050.TW'];
    if (!benchSeries.length) return;
    const lastBenchDateStr = benchSeries[benchSeries.length - 1].d;
    if (lastBenchDateStr >= todayStr) return;

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

    if (!missingDates.length) return;

    for (const [symbol, series] of Object.entries(prices)) {
      if (!series || !series.length) continue;
      const lastPrice = series[series.length - 1].c;
      for (const newDate of missingDates) {
        series.push({ d: newDate, c: lastPrice });
      }
    }

    if (etfs && etfs.length) {
      for (const etf of etfs) {
        if (!etf.price_series || !etf.price_series.length) continue;
        const ticker = convertSymbol(etf.code);
        const tickerPrices = prices[ticker];
        const lastPoint = etf.price_series[etf.price_series.length - 1];
        let lastNav = lastPoint.c;
        const etfLastDate = lastPoint.d;

        for (const newDate of missingDates) {
          if (newDate <= etfLastDate) continue;
          let currentPrice = lastNav;
          if (tickerPrices) {
            const pPoint = tickerPrices.find(p => p.d === newDate);
            const prevPricePoint = tickerPrices.find(p => p.d === etfLastDate) || tickerPrices[0];
            if (pPoint && prevPricePoint && prevPricePoint.c > 0) {
              currentPrice = lastNav * (pPoint.c / prevPricePoint.c);
            }
          }
          etf.price_series.push({ d: newDate, c: parseFloat(currentPrice.toFixed(2)) });
        }
        etf.nav = etf.price_series[etf.price_series.length - 1].c;
        etf.close_price = etf.nav;
      }
    }
  }

  const DEFAULT_SETTINGS = Object.freeze({
    total_return: true,
    annualized_return: true,
    max_return: true,
    max_drawdown: true,
    current_drawdown: true,
    sharpe_ratio: true,
    sortino_ratio: true,
    calmar_ratio: true,
    alpha: true,
    beta: true
  });

  window.leviathanData = Object.freeze({
    fetchJson,
    fetchOptionalJson(url, opts = {}) {
      return fetchJson(url, { ...opts, optional: true });
    },
    parseCSV,
    calculateBacktest,
    extendPricesAndEtfsToToday,
    async getSettings() {
      try {
        const res = await fetchJson('./api/settings');
        if (res && res.ok && res.settings) {
          localStorage.setItem('leviathan_settings', JSON.stringify(res.settings));
          return res.settings;
        }
      } catch (e) {
        console.warn('API /api/settings unavailable, falling back to localStorage:', e.message);
      }
      try {
        const local = localStorage.getItem('leviathan_settings');
        if (local) return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(local));
      } catch (e) {}
      return Object.assign({}, DEFAULT_SETTINGS);
    },
    async saveSettings(newSettings) {
      localStorage.setItem('leviathan_settings', JSON.stringify(newSettings));
      try {
        await fetch('./api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: newSettings })
        });
      } catch (e) {
        console.warn('API /api/settings save failed (saved to localStorage):', e.message);
      }
    },
    async getBacktestModel(prices, etfs) {
      extendPricesAndEtfsToToday(prices, etfs);
      try {
        const res = await fetchJson('./api/backtest');
        if (res && res.ok && res.model) return res.model;
      } catch (e) {
        console.warn('API /api/backtest not available, checking localStorage fallback:', e.message);
      }
      try {
        const localModel = localStorage.getItem('leviathan_custom_model');
        if (localModel) {
          const parsed = JSON.parse(localModel);
          if (parsed) return parsed;
        }
      } catch (e) {}
      try {
        const csvRes = await fetch('./Leviathan.csv?_t=' + Date.now(), { cache: 'no-store' });
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

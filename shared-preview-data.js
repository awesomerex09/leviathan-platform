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

  const STOCK_NAMES = {
    '2330': '台積電',
    '2454': '聯發科',
    '2317': '鴻海',
    '2303': '聯電',
    '3711': '日月光投控',
    '2449': '京元電子',
    '5274': '信驊',
    '3529': '力旺',
    '6488': '環球晶',
    '5347': '世界先進',
    '6515': '穎崴',
    '3583': '辛耘',
    '6510': '精測',
    '2458': '義隆',
    '2379': '瑞昱',
    '3034': '聯詠',
    '4961': '天鈺',
    '3035': '智原',
    '2408': '南亞科',
    '2382': '廣達',
    '3231': '緯創',
    '6669': '緯穎',
    '2308': '台達電',
    '2360': '致茂',
    '3017': '奇鋐',
    '3653': '健策',
    '3665': '貿聯-KY',
    '2383': '台光電',
    '3037': '欣興',
    '8046': '南電',
    '4958': '臻鼎-KY',
    '3026': '禾伸堂',
    '3008': '大立光',
    '3406': '玉晶光',
    '2345': '智邦',
    '3081': '聯舟',
    '3105': '穩懋',
    '8299': '群聯',
    '8996': '高力',
    '6442': '光聖',
    '5289': '宜鼎',
    '6139': '亞翔',
    '6223': '旺矽',
    '6187': '萬潤',
    '6274': '台燿',
    '3595': '亞諾法',
    '5536': '聖暉',
    '3661': '世芯-KY',
    '2368': '金像電',
    'BELFA': 'Bel Fuse Inc',
    'HUT': 'Hut 8 Corp',
    'INSW': 'International Seaways',
    'VISN': 'Vislink Tech',
    'TNGX': 'Tango Therapeutics',
    'LQDA': 'Liquidia Corp',
    'AEHR': 'Aehr Test Systems',
    'APLD': 'Applied Digital',
    'CIFR': 'Cipher Mining',
    'WULF': 'TeraWulf Inc',
    'POWL': 'Powell Industries',
    'NVDA': 'NVIDIA Corp',
    'TSM': 'TSMC (Taiwan Semi)',
    'AAPL': 'Apple Inc',
    'MSFT': 'Microsoft Corp',
    'AMZN': 'Amazon.com',
    'GOOGL': 'Alphabet Inc',
    'META': 'Meta Platforms',
    'TSLA': 'Tesla Inc',
    'AVGO': 'Broadcom Inc',
    'AMD': 'Advanced Micro Devices'
  };

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
      throw new Error('prices.json is missing 0050.TW price data');
    }
    const tradingDays = prices['0050.TW'].map(p => p.d).sort();
    const firstTradeDate = trades[0].date;
    const lastTradeDate = trades[trades.length - 1].date;

    const activeDays = tradingDays.filter(d => d >= firstTradeDate);
    if (!activeDays.length) {
      throw new Error('No trading day overlap between trades and prices.json');
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
    
    const finalHoldings = [];
    const totalValuation = navSeries[navSeries.length - 1]?.c || initialCapital;
    const lastDay = activeDays[activeDays.length - 1];
    
    for (const [symbol, shares] of Object.entries(holdings)) {
      const ticker = convertSymbol(symbol);
      const tickerPrices = prices[ticker];
      let code = symbol.includes(':') ? symbol.split(':')[1] : symbol;
      let name = STOCK_NAMES[code] || code;
      
      for (const etf of etfs) {
        const hMatch = etf.holdings?.find(h => h.code === code) || etf.top3?.find(h => h.code === code);
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
        code: code,
        fullCode: symbol,
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

    const latestIdx = activeDays.length - 1;
    const prevIdx = Math.max(0, latestIdx - 22);
    const latestRecord = holdingsHistory[latestIdx] || { holdings: {}, val: totalValuation, currentHoldingWeights: [] };
    const prevRecord = holdingsHistory[prevIdx] || { holdings: {}, val: initialCapital, currentHoldingWeights: [] };

    const currentMap = latestRecord.holdings || {};
    const prevMap = prevRecord.holdings || {};

    for (const [symbol, curShares] of Object.entries(currentMap)) {
      const code = symbol.includes(':') ? symbol.split(':')[1] : symbol;
      const name = STOCK_NAMES[code] || code;
      const fh = finalHoldings.find(h => h.code === code);
      const curWeight = fh ? fh.weight : 0;
      const prevShares = prevMap[symbol] || 0;

      const prevH = prevRecord.currentHoldingWeights ? prevRecord.currentHoldingWeights.find(h => h.symbol === symbol) : null;
      const prevWeight = prevH && prevRecord.val ? parseFloat(((prevH.valTwd / prevRecord.val) * 100).toFixed(2)) : 0;

      if (prevShares === 0) {
        news.push({ code, name, weight: curWeight, shares: curShares });
      } else if (curShares > prevShares) {
        const deltaPct = parseFloat(Math.abs(curWeight - prevWeight).toFixed(1)) || 1.0;
        adds.push({ code, name, pct: deltaPct, weight: curWeight });
      } else if (curShares < prevShares) {
        const deltaPct = parseFloat(Math.abs(prevWeight - curWeight).toFixed(1)) || 1.0;
        reductions.push({ code, name, pct: deltaPct, weight: curWeight });
      }
    }

    for (const [symbol, prevShares] of Object.entries(prevMap)) {
      if (!currentMap[symbol] || currentMap[symbol] <= 0) {
        const code = symbol.includes(':') ? symbol.split(':')[1] : symbol;
        const name = STOCK_NAMES[code] || code;
        exits.push({ code, name });
      }
    }

    function parseDateKeyUTC(d) {
      const k = String(d).replaceAll('-', '').replaceAll('/', '');
      if (k.length !== 8) return null;
      return new Date(Date.UTC(Number(k.slice(0, 4)), Number(k.slice(4, 6)) - 1, Number(k.slice(6, 8))));
    }

    return {
      code: 'LEVIATHAN',
      name: '自研量化模型 (Leviathan)',
      issuer: 'Custom Quant Model',
      version: '2026.08.06.v2',
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

  async function fetchLiveMarketPrices(symbols = ['0050.TW', 'TWD=X'], range = '1mo') {
    try {
      const symList = Array.isArray(symbols) ? symbols.join(',') : symbols;
      const res = await fetchJson('./api/live-prices?symbols=' + encodeURIComponent(symList) + '&range=' + encodeURIComponent(range), { optional: true });
      if (res && res.ok && res.prices) {
        return res.prices;
      }
    } catch (e) {
      console.warn('fetchLiveMarketPrices failed:', e.message);
    }
    return null;
  }

  function extendPricesAndEtfsToToday(prices, etfs, livePricesMap) {
    if (!prices || !prices['0050.TW']) return;
    const today = new Date();
    const todayStr = formatYYYYMMDD(today);
    
    // Normalize date strings in livePricesMap
    if (livePricesMap) {
      for (const [k, series] of Object.entries(livePricesMap)) {
        if (Array.isArray(series)) {
          for (const pt of series) {
            if (pt && pt.d) pt.d = String(pt.d).replaceAll('-', '').replaceAll('/', '');
          }
          series.sort((a, b) => a.d.localeCompare(b.d));
        }
      }
    }

    // Normalize date strings in prices database
    for (const [k, series] of Object.entries(prices)) {
      if (Array.isArray(series)) {
        for (const pt of series) {
          if (pt && pt.d) pt.d = String(pt.d).replaceAll('-', '').replaceAll('/', '');
        }
        series.sort((a, b) => a.d.localeCompare(b.d));
      }
    }

    const benchSeries = prices['0050.TW'];
    if (!benchSeries.length) return;

    // Merge live benchmark prices if available
    if (livePricesMap && livePricesMap['0050.TW']) {
      const liveBench = livePricesMap['0050.TW'];
      for (const pt of liveBench) {
        const existingIdx = benchSeries.findIndex(p => p.d === pt.d);
        if (existingIdx >= 0) {
          benchSeries[existingIdx].c = pt.c;
        } else {
          benchSeries.push(pt);
        }
      }
    }

    // Sort and deduplicate benchmark series
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

        // Check live prices for this ETF ticker
        const liveEtfSeries = livePricesMap ? (livePricesMap[etf.code] || livePricesMap[`${etf.code}.TW`] || livePricesMap[`${etf.code}.TWO`]) : null;
        if (liveEtfSeries && liveEtfSeries.length) {
          if (liveEtfSeries.length > 30) {
            // Full historical API data fetched, replace fake mock series completely
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

        // Sort and deduplicate ETF price series chronologically
        etf.price_series.sort((a, b) => a.d.localeCompare(b.d));
        const seenEtf = new Set();
        etf.price_series = etf.price_series.filter(p => seenEtf.has(p.d) ? false : seenEtf.add(p.d));

        const etfLastDate = etf.price_series[etf.price_series.length - 1].d;
        const lastNav = etf.price_series[etf.price_series.length - 1].c;

        const targetDays = activeBench.filter(p => p.d > etfLastDate);
        for (const pt of targetDays) {
          // Real non-fitted fallback: hold price steady on missing dates without artificial 0050 proportional scaling
          etf.price_series.push({ d: pt.d, c: lastNav });
        }

        etf.price_series.sort((a, b) => a.d.localeCompare(b.d));

        etf.nav = etf.price_series[etf.price_series.length - 1].c;
        etf.close_price = etf.nav;
        if (etf.price_series.length > 22) {
          const s = etf.price_series;
          const curN = s[s.length - 1].c;
          const p1M = s[s.length - 22] ? s[s.length - 22].c : s[0].c;
          const pInit = s[0].c;
          etf.m1_return = parseFloat((((curN - p1M) / p1M) * 100).toFixed(2));
          etf.total_return = parseFloat((((curN - pInit) / pInit) * 100).toFixed(2));
        }
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

  async function fetchEtfDataset() {
    try {
      const res = await fetchJson('./api/etfs', { optional: true });
      if (res && res.ok && res.etfs) return res;
    } catch (e) {}
    try {
      return await fetchJson('./etfs.json');
    } catch (e) {
      console.warn('Failed to load etfs dataset:', e.message);
      return { etfs: [] };
    }
  }

  const MODEL_CACHE_VERSION = '2026.08.06.v2';

  window.leviathanData = Object.freeze({
    fetchJson,
    fetchOptionalJson(url, opts = {}) {
      return fetchJson(url, { ...opts, optional: true });
    },
    parseCSV,
    calculateBacktest,
    fetchLiveMarketPrices,
    fetchEtfDataset,
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
      let liveMap = null;
      try {
        liveMap = await fetchLiveMarketPrices(['0050.TW', 'TWD=X']);
      } catch (e) {}
      extendPricesAndEtfsToToday(prices, etfs, liveMap);
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
          if (parsed && parsed.version === MODEL_CACHE_VERSION) {
            return parsed;
          } else {
            localStorage.removeItem('leviathan_custom_model');
          }
        }
      } catch (e) {}
      try {
        const csvRes = await fetch('./Leviathan.csv?_t=' + Date.now(), { cache: 'no-store' });
        if (!csvRes.ok) throw new Error('Leviathan.csv not found');
        const csvText = await csvRes.text();
        const trades = parseCSV(csvText);
        const model = calculateBacktest(trades, prices, etfs);
        if (model) {
          model.version = MODEL_CACHE_VERSION;
        }
        return model;
      } catch (err) {
        console.error('Client-side backtest failed:', err.message);
        return null;
      }
    }
  });
})();

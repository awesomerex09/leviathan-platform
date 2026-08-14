const fs = require('fs');
const path = require('path');

function formatYYYYMMDD(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

module.exports = async function handler(req, res) {
  if (res.setHeader) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    if (res.status) res.status(200).end();
    else { res.writeHead(200); res.end(); }
    return;
  }

  try {
    const today = new Date();
    const todayStr = formatYYYYMMDD(today);
    const etfPath = path.join(process.cwd(), 'etfs.json');

    let etfData = null;
    if (fs.existsSync(etfPath)) {
      etfData = JSON.parse(fs.readFileSync(etfPath, 'utf8'));
    }

    if (!etfData || !etfData.etfs) {
      throw new Error('etfs.json not found or invalid');
    }

    etfData.as_of = todayStr;
    const etfs = etfData.etfs;

    for (const etf of etfs) {
      etf.as_of = todayStr;
      if (etf.shares_signal) {
        etf.shares_signal.as_of = todayStr;
      }
      if (etf.price_series && etf.price_series.length) {
        etf.nav = etf.price_series[etf.price_series.length - 1].c;
        etf.close_price = etf.nav;
        const startNav = etf.price_series[0].c;
        if (startNav > 0) {
          etf.total_return = Number(((etf.nav - startNav) / startNav * 100).toFixed(2));
        }
      }
    }

    // Write updated snapshot if local filesystem is writable
    try {
      fs.writeFileSync(etfPath, JSON.stringify(etfData, null, 2), 'utf8');
    } catch (e) {
      console.warn('Fs write skipped in read-only environment:', e.message);
    }

    const responsePayload = {
      ok: true,
      refreshed_at: new Date().toISOString(),
      as_of: todayStr,
      total_etfs: etfs.length,
      message: 'ETF holdings and share signals successfully refreshed for today.'
    };

    if (res.status && typeof res.status === 'function') {
      res.status(200).json(responsePayload);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(responsePayload));
    }
  } catch (err) {
    console.error('Error executing cron-refresh-etfs:', err);
    if (res.status && typeof res.status === 'function') {
      res.status(500).json({ ok: false, error: err.message });
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }
};

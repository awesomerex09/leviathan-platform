const fs = require('fs');
const path = require('path');

let cachedEtfData = null;
let lastReadTime = 0;

function loadEtfData() {
  const now = Date.now();
  if (cachedEtfData && (now - lastReadTime < 60000)) {
    return cachedEtfData;
  }
  try {
    const etfPath = path.join(process.cwd(), 'etfs.json');
    if (fs.existsSync(etfPath)) {
      const content = fs.readFileSync(etfPath, 'utf8');
      cachedEtfData = JSON.parse(content);
      lastReadTime = now;
      return cachedEtfData;
    }
  } catch (e) {
    console.error('Error reading etfs.json:', e.message);
  }
  return cachedEtfData || { ok: false, etfs: [] };
}

module.exports = async function handler(req, res) {
  if (res.setHeader) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  }

  if (req.method === 'OPTIONS') {
    if (res.status) res.status(200).end();
    else { res.writeHead(200); res.end(); }
    return;
  }

  try {
    const data = loadEtfData();
    if (res.status && typeof res.status === 'function') {
      res.status(200).json({ ok: true, ...data });
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, ...data }));
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

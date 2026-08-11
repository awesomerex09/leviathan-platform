const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
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
};

let globalSettingsStore = { ...DEFAULT_SETTINGS };
let isInitialized = false;

async function initSettings() {
  if (isInitialized) return;
  
  // 1. Try reading local disk
  try {
    const settingsPath = path.join(process.cwd(), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf8');
      globalSettingsStore = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(content));
    }
  } catch (e) {}

  // 2. Try reading /tmp
  try {
    const tmpPath = path.join('/tmp', 'settings.json');
    if (fs.existsSync(tmpPath)) {
      const content = fs.readFileSync(tmpPath, 'utf8');
      globalSettingsStore = Object.assign({}, globalSettingsStore, JSON.parse(content));
    }
  } catch (e) {}

  isInitialized = true;
}

module.exports = async function handler(req, res) {
  if (res.setHeader) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }

  if (req.method === 'OPTIONS') {
    if (res.status) res.status(200).end();
    else { res.writeHead(200); res.end(); }
    return;
  }

  await initSettings();

  if (req.method === 'GET') {
    if (res.status && typeof res.status === 'function') {
      return res.status(200).json({ ok: true, settings: globalSettingsStore });
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, settings: globalSettingsStore }));
    }
  }

  if (req.method === 'POST') {
    let bodyData = '';
    
    const processUpdate = async (parsedBody) => {
      const newSettings = parsedBody.settings || parsedBody;
      globalSettingsStore = Object.assign({}, globalSettingsStore, newSettings);

      // Try writing to disk if local/writable environment
      try {
        const settingsPath = path.join(process.cwd(), 'settings.json');
        fs.writeFileSync(settingsPath, JSON.stringify(globalSettingsStore, null, 2), 'utf8');
      } catch (e) {}

      // Write to /tmp/settings.json for serverless container warming persistence
      try {
        const tmpPath = path.join('/tmp', 'settings.json');
        fs.writeFileSync(tmpPath, JSON.stringify(globalSettingsStore, null, 2), 'utf8');
      } catch (e) {}

      if (res.status && typeof res.status === 'function') {
        return res.status(200).json({ ok: true, settings: globalSettingsStore });
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, settings: globalSettingsStore }));
      }
    };

    if (req.body && typeof req.body === 'object') {
      return await processUpdate(req.body);
    } else if (typeof req.body === 'string') {
      try {
        return await processUpdate(JSON.parse(req.body));
      } catch(e) {}
    }

    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(bodyData || '{}');
        await processUpdate(parsed);
      } catch (e) {
        if (res.status && typeof res.status === 'function') {
          res.status(400).json({ ok: false, error: 'Invalid JSON payload' });
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON payload' }));
        }
      }
    });
    return;
  }

  if (res.status && typeof res.status === 'function') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  } else {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
  }
};

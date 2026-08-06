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

// Check Vercel KV REST environment variables
const KV_URL = process.env.KV_REST_API_URL || process.env.VERCEL_KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.VERCEL_KV_REST_API_TOKEN;

async function fetchKvSettings() {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/get/leviathan_settings`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.result) {
      const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      return parsed;
    }
  } catch (e) {
    console.warn('Vercel KV get error:', e.message);
  }
  return null;
}

async function saveKvSettings(settings) {
  if (!KV_URL || !KV_TOKEN) return false;
  try {
    await fetch(`${KV_URL}/set/leviathan_settings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(settings)
    });
    return true;
  } catch (e) {
    console.warn('Vercel KV set error:', e.message);
  }
  return false;
}

// Free public fallback JSON store (Zero setup required)
const JSONBLOB_URL = 'https://jsonblob.com/api/jsonBlob/019fd54d-6683-761c-b719-984b3e7adbb6';

async function fetchJsonBlob() {
  try {
    const res = await fetch(JSONBLOB_URL);
    if (res.ok) return await res.json();
  } catch (e) {}
  return null;
}

async function saveJsonBlob(settings) {
  try {
    await fetch(JSONBLOB_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(settings)
    });
  } catch (e) {}
}

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

  // 3. Try reading Vercel KV if available, else JSONBlob
  let remoteSettings = await fetchKvSettings();
  if (!remoteSettings) {
    remoteSettings = await fetchJsonBlob();
  }
  
  if (remoteSettings) {
    globalSettingsStore = Object.assign({}, globalSettingsStore, remoteSettings);
  }

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
    // Re-check remote storage on GET to get freshest state across cold starts
    let remoteSettings = await fetchKvSettings();
    if (!remoteSettings) {
      remoteSettings = await fetchJsonBlob();
    }
    if (remoteSettings) {
      globalSettingsStore = Object.assign({}, globalSettingsStore, remoteSettings);
    }

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
      
      // Save to Vercel KV if configured, else fallback to JSONBlob
      const kvSaved = await saveKvSettings(globalSettingsStore);
      if (!kvSaved) {
        await saveJsonBlob(globalSettingsStore);
      }

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

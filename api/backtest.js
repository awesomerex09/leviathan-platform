const fs = require('fs');
const path = require('path');

let memoryModelStore = null;

async function getStoredModel() {
  if (memoryModelStore !== null) return memoryModelStore;

  // Read from local deployed file
  try {
    const modelPath = path.join(process.cwd(), 'leviathan_model.json');
    if (fs.existsSync(modelPath)) {
      const content = fs.readFileSync(modelPath, 'utf8');
      if (content) {
        memoryModelStore = JSON.parse(content);
        return memoryModelStore;
      }
    }
  } catch (e) {}

  // Fallback check /tmp
  try {
    const tmpPath = path.join('/tmp', 'leviathan_custom_model.json');
    if (fs.existsSync(tmpPath)) {
      const content = fs.readFileSync(tmpPath, 'utf8');
      if (content) {
        memoryModelStore = JSON.parse(content);
        return memoryModelStore;
      }
    }
  } catch (e) {}

  return null;
}

module.exports = async function handler(req, res) {
  if (res.setHeader) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }

  if (req.method === 'OPTIONS') {
    if (res.status) res.status(200).end();
    else { res.writeHead(200); res.end(); }
    return;
  }

  if (req.method === 'GET') {
    const model = await getStoredModel();
    if (res.status && typeof res.status === 'function') {
      return res.status(200).json({ ok: true, model: model || null });
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, model: model || null }));
    }
  }

  if (res.status && typeof res.status === 'function') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  } else {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
  }
};

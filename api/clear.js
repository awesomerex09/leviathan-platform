const fs = require('fs');
const path = require('path');

const KV_URL = process.env.KV_REST_API_URL || process.env.VERCEL_KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.VERCEL_KV_REST_API_TOKEN;
const JSONBLOB_URL = 'https://jsonblob.com/api/jsonBlob/019fd7ce-ac07-7d04-98c7-a4a48c411f07';

async function clearKvModel() {
  if (!KV_URL || !KV_TOKEN) return false;
  try {
    await fetch(`${KV_URL}/set/leviathan_custom_model`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(null)
    });
    return true;
  } catch (e) {
    console.warn('Vercel KV clear error:', e.message);
  }
  return false;
}

async function clearJsonBlobModel() {
  try {
    await fetch(JSONBLOB_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ model: null })
    });
  } catch (e) {
    console.warn('JSONBlob clear error:', e.message);
  }
}

module.exports = async function handler(req, res) {
  if (res.setHeader) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }

  if (req.method === 'OPTIONS') {
    if (res.status) res.status(200).end();
    else { res.writeHead(200); res.end(); }
    return;
  }

  if (req.method === 'POST') {
    try {
      const tmpPath = path.join('/tmp', 'leviathan_custom_model.json');
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch (e) {}

    await clearKvModel();
    await clearJsonBlobModel();

    if (res.status && typeof res.status === 'function') {
      return res.status(200).json({ ok: true });
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true }));
    }
  }

  if (res.status && typeof res.status === 'function') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  } else {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
  }
};

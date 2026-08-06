const fs = require('fs');
const path = require('path');

const KV_URL = process.env.KV_REST_API_URL || process.env.VERCEL_KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.VERCEL_KV_REST_API_TOKEN;
const JSONBLOB_URL = 'https://jsonblob.com/api/jsonBlob/019fd7ce-ac07-7d04-98c7-a4a48c411f07';

let memoryModelStore = null;

async function fetchKvModel() {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/get/leviathan_custom_model`, {
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

async function fetchJsonBlobModel() {
  try {
    const res = await fetch(JSONBLOB_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.model !== undefined) return data.model;
      if (data && data.code === 'LEVIATHAN') return data;
    }
  } catch (e) {
    console.warn('JSONBlob get error:', e.message);
  }
  return null;
}

async function getStoredModel() {
  // 1. Check memory store
  if (memoryModelStore !== null) return memoryModelStore;

  // 2. Check /tmp
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

  // 3. Try Vercel KV, then JSONBlob
  let remote = await fetchKvModel();
  if (!remote) {
    remote = await fetchJsonBlobModel();
  }

  if (remote) {
    memoryModelStore = remote;
    return memoryModelStore;
  }

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

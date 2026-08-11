module.exports = async function handler(req, res) {
  if (res.setHeader) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  if (res.status && typeof res.status === 'function') {
    return res.status(403).json({ ok: false, error: '請在本機後台 (localhost:3000/admin.html) 進行模型上傳與發布。' });
  } else {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: '請在本機後台 (localhost:3000/admin.html) 進行模型上傳與發布。' }));
  }
};

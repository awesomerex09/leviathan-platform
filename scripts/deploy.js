const { execSync, spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 要提交的資料檔案（不含 CSV，已加入 .gitignore）
const DATA_FILES = [
  'leviathan_model.json',
  'etfs.json',
  'prices.json',
  'settings.json',
  'site-stats.json',
];

console.log('[Deploy] Preparing GitHub Pages deployment...');

try {
  // 設定 git user（若尚未設定）
  try {
    execSync('git config user.email', { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    execSync('git config user.email "deploy@leviathan.local"', { cwd: ROOT });
    execSync('git config user.name "Leviathan Auto-Deploy"', { cwd: ROOT });
  }

  // Stage 白名單資料檔案（有變動才加）
  for (const f of DATA_FILES) {
    try {
      execSync(`git add "${f}"`, { cwd: ROOT, stdio: 'pipe' });
    } catch (e) { /* 檔案不存在則跳過 */ }
  }

  // 同步 stage 前端靜態資源修改
  const staticPatterns = ['*.html', 'shared*.js', 'shared.css', 'api/*.js', 'scripts/serve.js', 'scripts/deploy.js', '.gitignore', 'vercel.json', 'manifest.json', 'favicon.svg', 'brand-mark.svg'];
  for (const pattern of staticPatterns) {
    try {
      execSync(`git add ${pattern}`, { cwd: ROOT, stdio: 'pipe' });
    } catch (e) { /* ignore */ }
  }

  // 檢查有無需要 commit 的內容
  const staged = execSync('git diff --staged --name-only', { cwd: ROOT }).toString().trim();
  if (!staged) {
    console.log('[Deploy] Nothing to commit — data unchanged, skipping push.');
    process.exit(0);
  }

  console.log('[Deploy] Files to commit:');
  staged.split('\n').forEach(f => console.log(`  ${f}`));

  // Commit
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  execSync(`git commit -m "chore: update model data ${timestamp} [auto]"`, { cwd: ROOT });
  console.log('[Deploy] Committed.');

  // Push
  console.log('[Deploy] Pushing to GitHub (origin main)...');
  const pushChild = spawn('git', ['push', 'origin', 'main'], {
    cwd: ROOT,
    stdio: 'inherit'
  });

  pushChild.on('close', (code) => {
    if (code === 0) {
      console.log('[Deploy] Push successful! GitHub Pages will update in ~1 minute.');
      console.log('[Deploy]    https://awesomerex09.github.io/leviathan-platform/');
    } else {
      console.error(`[Deploy] git push failed (code ${code}). Run "git push origin main" manually.`);
    }
  });

} catch (err) {
  console.error('[Deploy] Error during deployment:', err.message);
  process.exit(1);
}

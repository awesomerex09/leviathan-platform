const fs = require('fs');
const path = require('path');

const srcDir = 'c:/Users/VillainPrime/Desktop/JerryWeb/extracted';
const destDir = 'c:/Users/VillainPrime/Desktop/JerryWeb';

const filesToCopy = [
  { src: 'preview/index.html', dest: 'index.html' },
  { src: 'shared.css', dest: 'shared.css' },
  { src: 'brand-mark.svg', dest: 'brand-mark.svg' },
  { src: 'shared-preview-data.js', dest: 'shared-preview-data.js' },
  { src: 'shared-refresh.js', dest: 'shared-refresh.js' },
  { src: 'manifest.json', dest: 'manifest.json' },
  { src: 'preview/etfs.json', dest: 'etfs.json' },
  { src: 'favicon.svg', dest: 'favicon.svg' },
  { src: 'preview/site-stats.json', dest: 'site-stats.json' }
];

filesToCopy.forEach(item => {
  const srcPath = path.join(srcDir, item.src);
  const destPath = path.join(destDir, item.dest);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied ${srcPath} -> ${destPath}`);
  } else {
    console.warn(`File not found: ${srcPath}`);
  }
});

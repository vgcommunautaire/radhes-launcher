// Lancé automatiquement après « npm install ».
// Avec Node 26, la décompression d'Electron (extract-zip) s'arrête sans erreur et laisse un dossier incomplet.
// Ce script détecte ce cas et décompresse Electron avec l'outil tar intégré à Windows.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const dist = path.join(electronDir, 'dist');
const exe = process.platform === 'win32' ? 'electron.exe' : 'electron';

if (!fs.existsSync(electronDir) || fs.existsSync(path.join(dist, exe))) process.exit(0);

const { version } = require(path.join(electronDir, 'package.json'));
const { downloadArtifact } = require(require.resolve('@electron/get', { paths: [electronDir] }));

console.log(`Installation d'Electron ${version}...`);
downloadArtifact({
  version,
  artifactName: 'electron',
  platform: process.platform,
  arch: process.arch,
  checksums: require(path.join(electronDir, 'checksums.json')),
})
  .then((zip) => {
    fs.rmSync(dist, { recursive: true, force: true });
    fs.mkdirSync(dist, { recursive: true });
    execFileSync('tar', ['-xf', zip, '-C', dist], { stdio: 'inherit' });
    const types = path.join(dist, 'electron.d.ts');
    if (fs.existsSync(types)) fs.renameSync(types, path.join(electronDir, 'electron.d.ts'));
    fs.writeFileSync(path.join(electronDir, 'path.txt'), exe);
    console.log('Electron installé.');
  })
  .catch((err) => {
    console.error('Impossible d\'installer Electron :', err.message);
    process.exit(1);
  });

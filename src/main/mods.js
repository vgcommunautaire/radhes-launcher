// Manifest des mods et synchronisation du dossier mods/.
// Le dossier mods/ est géré par le launcher : tout .jar absent du manifest y est supprimé.
const fsp = require('fs').promises;
const path = require('path');
const dl = require('./download');
const { UserError } = require('./errors');

function validateManifest(m) {
  if (!m || typeof m.minecraftVersion !== 'string') throw new UserError('Le manifest des mods est invalide (version de Minecraft manquante).');
  if (m.loader?.type !== 'fabric') throw new UserError('Le manifest des mods est invalide : seul le loader Fabric est géré.');
  if (!Array.isArray(m.mods)) throw new UserError('Le manifest des mods est invalide (liste « mods » manquante).');
  for (const mod of m.mods) {
    // Le nom de fichier ne doit pas pouvoir sortir du dossier mods/.
    if (typeof mod.file !== 'string' || mod.file !== path.basename(mod.file) || !mod.file.toLowerCase().endsWith('.jar')) {
      throw new UserError(`Le manifest contient un nom de fichier invalide : ${mod.file}`);
    }
    if (!/^https:\/\//.test(mod.url || '')) throw new UserError(`Adresse de téléchargement invalide pour ${mod.file}.`);
    if (!/^[a-f0-9]{64}$/i.test(mod.sha256 || '')) throw new UserError(`Empreinte SHA-256 invalide pour ${mod.file}.`);
  }
  return m;
}

// Télécharge le manifest ; s'il est injoignable, réutilise la dernière copie connue.
async function loadManifest(url, root) {
  return validateManifest(await dl.fetchJsonCached(url, path.join(root, 'cache', 'manifest.json')));
}

function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

async function syncMods({ root, manifest, onProgress = () => {}, log }) {
  const modsDir = path.join(root, 'mods');
  await fsp.mkdir(modsDir, { recursive: true });
  const wanted = new Map(manifest.mods.map((m) => [m.file.toLowerCase(), m]));

  // Le dossier mods/ ne doit contenir que la liste officielle : tout le reste est supprimé
  // (mods ajoutés à la main, sous-dossiers, fichiers renommés, téléchargements interrompus...).
  for (const entry of await fsp.readdir(modsDir, { withFileTypes: true })) {
    if (entry.isFile() && wanted.has(entry.name.toLowerCase())) continue;
    log?.info(`Suppression de mods/${entry.name} (absent de la liste officielle)`);
    await fsp.rm(path.join(modsDir, entry.name), { recursive: true, force: true });
  }

  onProgress({ label: 'Vérification des mods...', percent: null });
  const tasks = manifest.mods.map((m) => ({ url: m.url, dest: path.join(modsDir, m.file), sha256: m.sha256, alwaysHash: true }));
  const count = await dl.downloadAll(tasks, {
    concurrency: 4,
    onProgress: ({ done, total }) => onProgress({ label: 'Téléchargement des mods...', percent: (done / total) * 100 }),
  });
  log?.info(`Mods à jour (${manifest.mods.length} au total, ${count} téléchargé(s)).`);
}

module.exports = { loadManifest, validateManifest, compareVersions, syncMods };

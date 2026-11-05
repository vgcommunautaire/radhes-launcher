// Manifest des mods et synchronisation du dossier mods/.
// Le dossier mods/ est géré par le launcher : tout .jar absent du manifest y est supprimé.
const fsp = require('fs').promises;
const path = require('path');
const dl = require('./download');
const { UserError } = require('./errors');

function validateEntries(list, ext) {
  for (const item of list) {
    // Le nom de fichier ne doit pas pouvoir sortir de son dossier (mods/ ou shaderpacks/).
    if (typeof item.file !== 'string' || item.file !== path.basename(item.file) || !item.file.toLowerCase().endsWith(ext)) {
      throw new UserError(`Le manifest contient un nom de fichier invalide : ${item.file}`);
    }
    if (!/^https:\/\//.test(item.url || '')) throw new UserError(`Adresse de téléchargement invalide pour ${item.file}.`);
    if (!/^[a-f0-9]{64}$/i.test(item.sha256 || '')) throw new UserError(`Empreinte SHA-256 invalide pour ${item.file}.`);
  }
}

function validateManifest(m) {
  if (!m || typeof m.minecraftVersion !== 'string') throw new UserError('Le manifest des mods est invalide (version de Minecraft manquante).');
  if (m.loader?.type !== 'fabric') throw new UserError('Le manifest des mods est invalide : seul le loader Fabric est géré.');
  if (!Array.isArray(m.mods)) throw new UserError('Le manifest des mods est invalide (liste « mods » manquante).');
  validateEntries(m.mods, '.jar');
  m.shaderpacks = Array.isArray(m.shaderpacks) ? m.shaderpacks : [];
  validateEntries(m.shaderpacks, '.zip');
  if (m.defaultShader && !m.shaderpacks.some((s) => s.file === m.defaultShader)) {
    throw new UserError('Le manifest est invalide : le shader par défaut ne fait pas partie de la liste.');
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

// Shaders : le launcher télécharge ceux de la liste sans toucher aux shaders ajoutés par le joueur.
// Il retient ceux qu'il a installés lui-même pour pouvoir les retirer s'ils quittent la liste.
async function syncShaders({ root, manifest, onProgress = () => {}, log }) {
  const dir = path.join(root, 'shaderpacks');
  const managedFile = path.join(dir, '.radhes-launcher.json');
  await fsp.mkdir(dir, { recursive: true });

  let managed = [];
  try { managed = JSON.parse(await fsp.readFile(managedFile, 'utf8')); } catch {}
  const wanted = new Set(manifest.shaderpacks.map((s) => s.file));
  for (const file of managed) {
    if (!wanted.has(file) && file === path.basename(file)) {
      log?.info(`Suppression du shader retiré de la liste : ${file}`);
      await fsp.rm(path.join(dir, file), { force: true });
    }
  }

  const tasks = manifest.shaderpacks.map((s) => ({ url: s.url, dest: path.join(dir, s.file), sha256: s.sha256, alwaysHash: true }));
  await dl.downloadAll(tasks, {
    concurrency: 2,
    onProgress: ({ done, total }) => onProgress({ label: 'Téléchargement des shaders...', percent: (done / total) * 100 }),
  });
  await fsp.writeFile(managedFile, JSON.stringify([...wanted]));

  if (manifest.defaultShader) await applyDefaultShader(root, manifest.defaultShader, log);
}

// Active le shader par défaut dans Iris (config/iris.properties), une seule fois par shader :
// si le joueur change ou coupe le shader ensuite, son choix est respecté.
async function applyDefaultShader(root, shader, log) {
  const configDir = path.join(root, 'config');
  const marker = path.join(configDir, '.radhes-shader-par-defaut');
  let applied = null;
  try { applied = (await fsp.readFile(marker, 'utf8')).trim(); } catch {}
  if (applied === shader) return;

  const propsFile = path.join(configDir, 'iris.properties');
  let lines = [];
  try { lines = (await fsp.readFile(propsFile, 'utf8')).split(/\r?\n/); } catch {}
  const set = (key, value) => {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i === -1) lines.push(`${key}=${value}`);
    else lines[i] = `${key}=${value}`;
  };
  set('shaderPack', shader);
  set('enableShaders', 'true');

  await fsp.mkdir(configDir, { recursive: true });
  await fsp.writeFile(propsFile, `${lines.filter((l, i) => l || i < lines.length - 1).join('\n')}\n`);
  await fsp.writeFile(marker, shader);
  log?.info(`Shader par défaut activé : ${shader}`);
}

module.exports = { loadManifest, validateManifest, compareVersions, syncMods, syncShaders };

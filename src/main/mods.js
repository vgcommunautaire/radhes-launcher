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
  m.resourcepacks = Array.isArray(m.resourcepacks) ? m.resourcepacks : [];
  validateEntries(m.resourcepacks, '.zip');
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

// Télécharge une liste de fichiers dans un dossier partagé avec le joueur (shaders, packs de textures)
// sans toucher à ses fichiers à lui. Le launcher retient ceux qu'il a installés pour pouvoir
// les retirer quand ils quittent la liste.
async function syncFolder({ dir, entries, label, onProgress, log }) {
  const managedFile = path.join(dir, '.radhes-launcher.json');
  await fsp.mkdir(dir, { recursive: true });

  let managed = [];
  try { managed = JSON.parse(await fsp.readFile(managedFile, 'utf8')); } catch {}
  const wanted = new Set(entries.map((s) => s.file));
  for (const file of managed) {
    if (!wanted.has(file) && file === path.basename(file)) {
      log?.info(`Suppression de ${path.basename(dir)}/${file} (retiré de la liste)`);
      await fsp.rm(path.join(dir, file), { force: true });
    }
  }

  const tasks = entries.map((s) => ({ url: s.url, dest: path.join(dir, s.file), sha256: s.sha256, alwaysHash: true }));
  await dl.downloadAll(tasks, {
    concurrency: 3,
    onProgress: ({ done, total }) => onProgress({ label, percent: (done / total) * 100 }),
  });
  await fsp.writeFile(managedFile, JSON.stringify([...wanted]));
}

async function syncShaders({ root, manifest, onProgress = () => {}, log }) {
  await syncFolder({ dir: path.join(root, 'shaderpacks'), entries: manifest.shaderpacks, label: 'Téléchargement des shaders...', onProgress, log });
  if (manifest.defaultShader) await applyDefaultShader(root, manifest.defaultShader, log);
}

async function syncResourcePacks({ root, manifest, onProgress = () => {}, log }) {
  await syncFolder({ dir: path.join(root, 'resourcepacks'), entries: manifest.resourcepacks, label: 'Téléchargement des packs de textures...', onProgress, log });
  await enforceResourcePacks(root, manifest.resourcepacks.map((p) => p.file), log);
}

// Impose les packs de textures officiels, dans l'ordre, à chaque lancement (options.txt du jeu).
// Les packs ajoutés par le joueur sont désactivés, pas supprimés. Les packs intégrés au jeu et aux mods
// (vanilla, fabric...) sont gardés ; les packs optionnels de Minecraft (programmer_art, high_contrast) sont retirés.
// `official` va du haut vers le bas (comme dans le menu du jeu) ; options.txt les liste du bas vers le haut.
async function enforceResourcePacks(root, official, log) {
  if (!official.length) return;
  const file = path.join(root, 'options.txt');
  let lines = [];
  try { lines = (await fsp.readFile(file, 'utf8')).split(/\r?\n/); } catch {}

  const readList = (key) => {
    const line = lines.find((l) => l.startsWith(`${key}:`));
    try { return line ? JSON.parse(line.slice(key.length + 1)) : null; } catch { return null; }
  };
  const writeList = (key, list) => {
    const value = `${key}:${JSON.stringify(list)}`;
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (i === -1) lines.push(value);
    else lines[i] = value;
  };

  const current = readList('resourcePacks') || ['vanilla', 'fabric'];
  const builtins = current.filter((p) => typeof p === 'string' && !p.startsWith('file/') && p !== 'programmer_art' && p !== 'high_contrast');
  if (!builtins.includes('vanilla')) builtins.unshift('vanilla');
  const wanted = [...builtins, ...[...official].reverse().map((f) => `file/${f}`)];
  const incompatible = (readList('incompatibleResourcePacks') || []).filter((p) => !wanted.includes(p));

  if (JSON.stringify(current) === JSON.stringify(wanted)) return;
  writeList('resourcePacks', wanted);
  writeList('incompatibleResourcePacks', incompatible);
  await fsp.writeFile(file, `${lines.filter((l, i) => l || i < lines.length - 1).join('\n')}\n`);
  log?.info(`Packs de textures imposés : ${official.join(' > ')}`);
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

module.exports = { loadManifest, validateManifest, compareVersions, syncMods, syncShaders, syncResourcePacks };

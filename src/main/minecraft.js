// Installation de Minecraft (fichiers officiels Mojang), de Java et de Fabric, puis lancement.
// Aucun fichier du jeu n'est redistribué : tout vient des serveurs de Mojang et de Fabric.
// Pas de dépendance à Electron : ce module fonctionne aussi dans Node seul.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const dl = require('./download');
const { UserError, HttpError } = require('./errors');

const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAVA_MANIFEST = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const RESOURCES = 'https://resources.download.minecraft.net';
const FABRIC_META = 'https://meta.fabricmc.net/v2';

const ARCH = os.arch() === 'arm64' ? 'arm64' : os.arch() === 'ia32' ? 'x86' : 'x86_64';
const JAVA_PLATFORM = os.arch() === 'arm64' ? 'windows-arm64' : os.arch() === 'ia32' ? 'windows-x86' : 'windows-x64';

function dirs(root) {
  return {
    root,
    versions: path.join(root, 'versions'),
    libraries: path.join(root, 'libraries'),
    assets: path.join(root, 'assets'),
    runtime: path.join(root, 'runtime'),
    cache: path.join(root, 'cache'),
  };
}

// --- Règles Mojang (os / arch / fonctionnalités) ---------------------------

function ruleMatches(rule) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== 'windows') return false;
    if (rule.os.arch && rule.os.arch !== ARCH) return false;
    if (rule.os.version && !new RegExp(rule.os.version).test(os.release())) return false;
    const range = rule.os.versionRange;
    if (range?.min && compareDotted(os.release(), range.min) < 0) return false;
    if (range?.max && compareDotted(os.release(), range.max) >= 0) return false;
  }
  // Démo, résolution forcée, Quick Play... : aucune de ces options n'est activée.
  if (rule.features && Object.values(rule.features).some((v) => v === true)) return false;
  return true;
}

function compareDotted(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

function rulesAllow(rules) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const rule of rules) if (ruleMatches(rule)) allowed = rule.action === 'allow';
  return allowed;
}

// "groupe:artefact:version[:classifieur]" → chemin Maven
function mavenPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`;
  return path.join(...group.split('.'), artifact, version, file);
}

function libraryKey(name) {
  const [group, artifact, , classifier] = name.split(':');
  return `${group}:${artifact}:${classifier || ''}`;
}

// --- Résolution des versions ---------------------------------------------

async function resolveVanilla(d, mcVersion) {
  const manifest = await dl.fetchJsonCached(VERSION_MANIFEST, path.join(d.cache, 'version_manifest_v2.json'));
  const entry = manifest.versions.find((v) => v.id === mcVersion);
  const jsonFile = path.join(d.versions, mcVersion, `${mcVersion}.json`);
  if (!entry) {
    if (await dl.exists(jsonFile)) return JSON.parse(await fsp.readFile(jsonFile, 'utf8'));
    throw new UserError(`La version Minecraft ${mcVersion} n'existe pas chez Mojang.`);
  }
  const task = { url: entry.url, dest: jsonFile, sha1: entry.sha1, alwaysHash: true };
  if (await dl.needsDownload(task)) await dl.downloadFile(task);
  return JSON.parse(await fsp.readFile(jsonFile, 'utf8'));
}

async function resolveFabric(d, mcVersion, loaderVersion) {
  let version = loaderVersion;
  const enc = encodeURIComponent;
  if (!version || version === 'latest') {
    const list = await dl.fetchJsonCached(`${FABRIC_META}/versions/loader/${enc(mcVersion)}`, path.join(d.cache, `fabric-loaders-${mcVersion}.json`));
    const pick = list.find((e) => e.loader.stable) || list[0];
    if (!pick) throw new UserError(`Fabric n'est pas encore disponible pour Minecraft ${mcVersion}.`);
    version = pick.loader.version;
  }
  const id = `fabric-loader-${version}-${mcVersion}`;
  try {
    return await dl.fetchJsonCached(
      `${FABRIC_META}/versions/loader/${enc(mcVersion)}/${enc(version)}/profile/json`,
      path.join(d.versions, id, `${id}.json`),
    );
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 400)) {
      throw new UserError(`Fabric ${version} n'existe pas pour Minecraft ${mcVersion}.`, { cause: err });
    }
    throw err;
  }
}

// --- Java ----------------------------------------------------------------

async function javaTasks(d, vanilla) {
  const component = vanilla.javaVersion?.component || 'jre-legacy';
  const all = await dl.fetchJsonCached(JAVA_MANIFEST, path.join(d.cache, 'java-runtimes.json'));
  const entry = all[JAVA_PLATFORM]?.[component]?.[0];
  if (!entry) throw new UserError(`Mojang ne fournit pas Java « ${component} » pour ce PC (${JAVA_PLATFORM}).`);

  const home = path.join(d.runtime, component);
  const files = await dl.fetchJsonCached(entry.manifest.url, path.join(d.cache, `java-${component}.json`));
  const tasks = [];
  for (const [rel, f] of Object.entries(files.files)) {
    if (f.type === 'file') {
      const raw = f.downloads.raw;
      tasks.push({ url: raw.url, dest: path.join(home, rel), sha1: raw.sha1, size: raw.size });
    }
  }
  return { tasks, javaw: path.join(home, 'bin', 'javaw.exe') };
}

// --- Bibliothèques, assets, client ---------------------------------------

function libraryTasks(d, vanilla, fabric) {
  const libs = new Map();
  for (const lib of vanilla.libraries || []) {
    if (!rulesAllow(lib.rules)) continue;
    const art = lib.downloads?.artifact;
    if (!art) continue;
    libs.set(libraryKey(lib.name), {
      url: art.url, dest: path.join(d.libraries, art.path), sha1: art.sha1, size: art.size,
    });
  }
  // Les bibliothèques de Fabric remplacent les éventuels doublons de la version de base.
  for (const lib of fabric.libraries || []) {
    if (!rulesAllow(lib.rules)) continue;
    const rel = mavenPath(lib.name);
    const base = (lib.url || 'https://libraries.minecraft.net/').replace(/\/?$/, '/');
    libs.set(libraryKey(lib.name), {
      url: base + rel.split(path.sep).join('/'), dest: path.join(d.libraries, rel), sha1: lib.sha1, size: lib.size,
    });
  }
  return [...libs.values()];
}

async function assetTasks(d, vanilla) {
  const idx = vanilla.assetIndex;
  const indexFile = path.join(d.assets, 'indexes', `${idx.id}.json`);
  const task = { url: idx.url, dest: indexFile, sha1: idx.sha1, size: idx.size, alwaysHash: true };
  if (await dl.needsDownload(task)) await dl.downloadFile(task);
  const index = JSON.parse(await fsp.readFile(indexFile, 'utf8'));
  return Object.values(index.objects).map(({ hash, size }) => ({
    url: `${RESOURCES}/${hash.slice(0, 2)}/${hash}`,
    dest: path.join(d.assets, 'objects', hash.slice(0, 2), hash),
    sha1: hash,
    size,
  }));
}

function clientTasks(d, vanilla) {
  const tasks = [];
  const client = vanilla.downloads.client;
  const clientJar = path.join(d.versions, vanilla.id, `${vanilla.id}.jar`);
  tasks.push({ url: client.url, dest: clientJar, sha1: client.sha1, size: client.size });

  let logArg = null;
  const logging = vanilla.logging?.client;
  if (logging?.file) {
    const logFile = path.join(d.assets, 'log_configs', logging.file.id);
    tasks.push({ url: logging.file.url, dest: logFile, sha1: logging.file.sha1, size: logging.file.size });
    logArg = logging.argument.replace('${path}', logFile);
  }
  return { tasks, clientJar, logArg };
}

// --- Installation complète -----------------------------------------------

// onProgress({ label, percent }) ; deep = vérifier l'empreinte de chaque fichier existant.
async function install({ root, mcVersion, loaderVersion, deep = false, onProgress = () => {} }) {
  const d = dirs(root);
  onProgress({ label: 'Préparation de Minecraft...', percent: null });
  const vanilla = await resolveVanilla(d, mcVersion);
  const fabric = await resolveFabric(d, mcVersion, loaderVersion);

  const java = await javaTasks(d, vanilla);
  const libraries = libraryTasks(d, vanilla, fabric);
  const client = clientTasks(d, vanilla);
  onProgress({ label: 'Préparation des ressources...', percent: null });
  const assets = await assetTasks(d, vanilla);

  const steps = [
    ['Téléchargement de Java', java.tasks],
    ['Téléchargement de Minecraft', [...client.tasks, ...libraries]],
    ['Téléchargement des ressources du jeu', assets],
  ];
  for (const [label, tasks] of steps) {
    onProgress({ label: deep ? `${label} (vérification)...` : `${label}...`, percent: null });
    await dl.downloadAll(tasks, {
      deep,
      onProgress: ({ done, total }) => onProgress({ label: `${label}...`, percent: (done / total) * 100 }),
    });
  }

  return { root, vanilla, fabric, javaw: java.javaw, libraries, clientJar: client.clientJar, logArg: client.logArg };
}

// --- Lancement -----------------------------------------------------------

function fill(str, vars) {
  return str.replace(/\$\{([^}]+)\}/g, (m, key) => (key in vars ? vars[key] : m));
}

function collectArgs(list, vars) {
  const out = [];
  for (const arg of list || []) {
    if (typeof arg === 'string') out.push(arg);
    else if (rulesAllow(arg.rules)) out.push(...[].concat(arg.value));
  }
  return out.map((a) => fill(a, vars));
}

function buildArgs(inst, { session, ramMb, launcherName, launcherVersion, clientId }) {
  const { vanilla, fabric } = inst;
  const d = dirs(inst.root);
  const nativesDir = path.join(d.versions, fabric.id, 'natives');
  fs.mkdirSync(nativesDir, { recursive: true });

  const classpath = [...inst.libraries.map((l) => l.dest), inst.clientJar].join(path.delimiter);
  const vars = {
    auth_player_name: session.profile.name,
    auth_uuid: session.profile.id,
    auth_access_token: session.mcAccessToken,
    auth_xuid: session.xuid || '0',
    clientid: clientId,
    user_type: 'msa',
    user_properties: '{}',
    version_name: fabric.id,
    version_type: vanilla.type,
    game_directory: inst.root,
    assets_root: d.assets,
    assets_index_name: vanilla.assetIndex.id,
    natives_directory: nativesDir,
    library_directory: d.libraries,
    classpath,
    classpath_separator: path.delimiter,
    launcher_name: launcherName,
    launcher_version: launcherVersion,
  };

  // Options Java conseillées par Mojang (ramasse-miettes...), sauf la mémoire, réglée par le joueur.
  const jvm = collectArgs(vanilla.arguments?.['default-user-jvm'], vars).filter((a) => !/^-Xm[sx]/.test(a));
  jvm.push(`-Xmx${ramMb}M`, `-Xms${Math.min(ramMb, 2048)}M`);
  if (vanilla.arguments?.jvm) {
    jvm.push(...collectArgs(vanilla.arguments.jvm, vars));
  } else {
    jvm.push(`-Djava.library.path=${nativesDir}`, '-cp', classpath);
  }
  jvm.push(...collectArgs(fabric.arguments?.jvm, vars));
  if (inst.logArg) jvm.push(inst.logArg);

  const game = vanilla.arguments?.game
    ? collectArgs(vanilla.arguments.game, vars)
    : fill(vanilla.minecraftArguments || '', vars).split(' ').filter(Boolean);
  game.push(...collectArgs(fabric.arguments?.game, vars));

  return [...jvm, fabric.mainClass || vanilla.mainClass, ...game];
}

// Démarre le jeu. Renvoie le processus ; la sortie du jeu est écrite dans logs/jeu-launcher.log.
function launch(inst, opts) {
  const args = buildArgs(inst, opts);
  const logPath = path.join(inst.root, 'logs', 'jeu-launcher.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const out = fs.openSync(logPath, 'w');
  const child = spawn(inst.javaw, args, { cwd: inst.root, detached: true, stdio: ['ignore', out, out], windowsHide: false });
  fs.closeSync(out);
  child.logPath = logPath;
  child.safeArgs = args.map((a) => (a === opts.session.mcAccessToken ? '***' : a));
  return child;
}

module.exports = { install, launch, buildArgs, rulesAllow, mavenPath };

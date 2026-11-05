#!/usr/bin/env node
// Publie la liste des mods : lit les dossiers mods/, shaderpacks/ et resourcepacks/, calcule les SHA-256,
// génère manifest.json et le met en ligne. Dans modpack.json : « defaultShader » (shader activé par défaut)
// et « resourcePacks » (packs de textures imposés, du haut vers le bas).
//
//   npm run publish-mods                           → GitHub Releases (release « mods » du dépôt)
//   npm run publish-mods -- --essai                → génère seulement dist/manifest.json, sans rien envoyer
//   npm run publish-mods -- --dossier D:\site\mods --url-base https://exemple.fr/mods/
//                                                  → copie les fichiers dans un dossier à synchroniser
//
// Les mods trouvés sur Modrinth (recherche par empreinte) sont téléchargés directement depuis Modrinth
// par les joueurs : ils ne sont pas ré-hébergés. Les autres (mod perso...) sont envoyés sur GitHub.
//
// Pour GitHub : définir la variable d'environnement GH_TOKEN (jeton avec le droit « Contents: write »).

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const modpack = require(path.join(ROOT, 'modpack.json'));
const { owner, repo } = pkg.build.publish[0];
const TAG = 'mods';
const UA = `radhes-launcher-publish/${pkg.version}`;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}
const DRY_RUN = process.argv.includes('--essai');
const OUT_DIR = arg('--dossier');
const BASE_URL = arg('--url-base');
const MODS_DIR = path.resolve(arg('--mods') || path.join(ROOT, 'mods'));
const SHADERS_DIR = path.join(ROOT, 'shaderpacks');
const RESOURCEPACKS_DIR = path.join(ROOT, 'resourcepacks');
const NO_MODRINTH = process.argv.includes('--sans-modrinth');

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

async function http(url, { method = 'GET', headers = {}, body, json } = {}) {
  const h = { 'User-Agent': UA, ...headers };
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const res = await fetch(url, { method, headers: h, body });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

// --- Fichiers locaux -------------------------------------------------------

// kind : 'mod' (.jar du dossier mods/) ou 'shader' (.zip du dossier shaderpacks/).
async function readLocalFiles(dir, ext, kind) {
  if (!fs.existsSync(dir)) {
    if (kind === 'mod') fail(`Dossier des mods introuvable : ${dir}`);
    return [];
  }
  const files = (await fsp.readdir(dir)).filter((f) => f.toLowerCase().endsWith(ext)).sort();
  if (!files.length && kind === 'mod') console.warn('⚠ Aucun .jar dans le dossier des mods : le manifest sera vide.');
  const items = [];
  for (const file of files) {
    const data = await fsp.readFile(path.join(dir, file));
    items.push({
      kind,
      dir,
      file,
      size: data.length,
      sha1: crypto.createHash('sha1').update(data).digest('hex'),
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
    });
  }
  return items;
}

async function resolveLoaderVersion() {
  if (modpack.loaderVersion && modpack.loaderVersion !== 'latest') return modpack.loaderVersion;
  const res = await http(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(modpack.minecraftVersion)}`);
  const list = res.ok ? res.data : [];
  const pick = list.find((e) => e.loader.stable) || list[0];
  if (!pick) fail(`Fabric n'est pas disponible pour Minecraft ${modpack.minecraftVersion}.`);
  return pick.loader.version;
}

// --- Modrinth --------------------------------------------------------------

async function matchModrinth(mods) {
  if (NO_MODRINTH || !mods.length) return;
  const res = await http('https://api.modrinth.com/v2/version_files', {
    method: 'POST',
    json: { hashes: mods.map((m) => m.sha1), algorithm: 'sha1' },
  });
  if (!res.ok) {
    console.warn(`⚠ Modrinth injoignable (${res.status}) : tous les mods seront hébergés sur GitHub.`);
    return;
  }
  const versions = res.data || {};
  const projectIds = [...new Set(Object.values(versions).map((v) => v.project_id))];
  const titles = {};
  if (projectIds.length) {
    const p = await http(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(projectIds))}`);
    for (const proj of p.ok ? p.data : []) titles[proj.id] = proj.title;
  }
  for (const mod of mods) {
    const v = versions[mod.sha1];
    const f = v?.files.find((x) => x.hashes.sha1 === mod.sha1);
    if (!f) continue;
    mod.url = f.url;
    mod.name = titles[v.project_id] || v.name;
    const loader = { shader: 'iris', resourcepack: 'minecraft' }[mod.kind] || 'fabric';
    if (!v.loaders.includes(loader)) console.warn(`⚠ ${mod.file} : cette version n'est pas marquée compatible ${loader} sur Modrinth.`);
    if (!v.game_versions.includes(modpack.minecraftVersion)) {
      console.warn(`⚠ ${mod.file} : cette version n'est pas marquée compatible Minecraft ${modpack.minecraftVersion} sur Modrinth.`);
    }
  }
}

// --- GitHub Releases ------------------------------------------------------

function gh(pathname, opts = {}) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const base = pathname.startsWith('https://') ? '' : 'https://api.github.com';
  return http(base + pathname, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...opts.headers },
  });
}

async function getOrCreateRelease() {
  let res = await gh(`/repos/${owner}/${repo}/releases/tags/${TAG}`);
  if (res.status === 404) {
    res = await gh(`/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      json: {
        tag_name: TAG,
        name: 'Mods',
        body: 'Fichiers des mods et manifest.json, gérés automatiquement par scripts/publish.js. Ne pas modifier à la main.',
        prerelease: true, // pour que electron-updater ne la prenne jamais pour une version du launcher
        make_latest: 'false',
      },
    });
  }
  if (res.status === 401) fail('Jeton GitHub refusé. Vérifie la variable GH_TOKEN.');
  if (res.status === 404) fail(`Dépôt ${owner}/${repo} introuvable (ou jeton sans accès). Vérifie package.json > build.publish.`);
  if (!res.ok) fail(`GitHub a répondu ${res.status} : ${JSON.stringify(res.data)}`);
  return res.data;
}

async function listAssets(releaseId) {
  const all = [];
  for (let page = 1; ; page++) {
    const res = await gh(`/repos/${owner}/${repo}/releases/${releaseId}/assets?per_page=100&page=${page}`);
    if (!res.ok) fail(`Impossible de lister les fichiers de la release (${res.status}).`);
    all.push(...res.data);
    if (res.data.length < 100) return all;
  }
}

async function uploadAsset(release, name, data, contentType) {
  const url = `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}&label=${encodeURIComponent(name)}`;
  const res = await gh(url, { method: 'POST', headers: { 'Content-Type': contentType }, body: data });
  if (!res.ok) fail(`Échec de l'envoi de ${name} (${res.status}) : ${JSON.stringify(res.data)}`);
  return res.data;
}

const deleteAsset = (id) => gh(`/repos/${owner}/${repo}/releases/assets/${id}`, { method: 'DELETE' });

// GitHub peut renommer les fichiers (espaces, accents...) : on retrouve un fichier par son libellé d'origine.
const assetOriginalName = (a) => a.label || a.name;

async function publishGithub(manifest, items, finish) {
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) fail('Variable GH_TOKEN manquante (jeton GitHub).');
  const release = await getOrCreateRelease();
  const assets = await listAssets(release.id);
  const keep = new Set(['manifest.json']);

  for (const mod of items.filter((m) => !m.url)) {
    keep.add(mod.file);
    const existing = assets.find((a) => assetOriginalName(a) === mod.file);
    if (existing && existing.digest === `sha256:${mod.sha256}`) {
      mod.url = existing.browser_download_url;
      console.log(`  = ${mod.file} (déjà en ligne)`);
      continue;
    }
    if (existing) await deleteAsset(existing.id);
    console.log(`  ↑ ${mod.file}`);
    const type = mod.kind === 'mod' ? 'application/java-archive' : 'application/zip';
    const uploaded = await uploadAsset(release, mod.file, await fsp.readFile(path.join(mod.dir, mod.file)), type);
    mod.url = uploaded.browser_download_url;
  }

  // Le manifest en dernier : les joueurs ne voient la nouvelle liste qu'une fois tous les fichiers en ligne.
  finish();
  const oldManifest = assets.find((a) => assetOriginalName(a) === 'manifest.json');
  if (oldManifest) await deleteAsset(oldManifest.id);
  const up = await uploadAsset(release, 'manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json');
  console.log(`  ↑ manifest.json → ${up.browser_download_url}`);

  for (const a of assets) {
    if (!keep.has(assetOriginalName(a))) {
      console.log(`  ✖ ${assetOriginalName(a)} (retiré)`);
      await deleteAsset(a.id);
    }
  }
}

// --- Dossier à synchroniser ------------------------------------------------

async function publishFolder(manifest, items, finish) {
  if (!BASE_URL) fail('Avec --dossier, indique aussi --url-base (adresse publique de ce dossier).');
  const base = BASE_URL.replace(/\/?$/, '/');
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const keep = new Set(['manifest.json']);
  for (const mod of items.filter((m) => !m.url)) {
    keep.add(mod.file);
    await fsp.copyFile(path.join(mod.dir, mod.file), path.join(OUT_DIR, mod.file));
    mod.url = base + encodeURIComponent(mod.file);
    console.log(`  → ${mod.file}`);
  }
  for (const f of await fsp.readdir(OUT_DIR)) {
    if (/\.(jar|zip)$/i.test(f) && !keep.has(f)) await fsp.rm(path.join(OUT_DIR, f));
  }
  finish();
  await fsp.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`  → manifest.json (à mettre en ligne à l'adresse ${base}manifest.json)`);
}

// --- Principal -------------------------------------------------------------

// Range les packs selon modpack.json > resourcePacks (du haut vers le bas). Chaque pack du dossier doit y figurer.
function orderResourcePacks(packs) {
  const order = modpack.resourcePacks || [];
  for (const name of order) {
    if (!packs.some((p) => p.file === name)) fail(`Le pack « ${name} » (modpack.json) n'est pas dans le dossier resourcepacks.`);
  }
  for (const p of packs) {
    if (!order.includes(p.file)) fail(`Le pack « ${p.file} » n'est pas dans la liste resourcePacks de modpack.json : ajoute-le à la place voulue.`);
  }
  return order.map((name) => packs.find((p) => p.file === name));
}

function toManifestEntries(items) {
  return items.map((m) => ({ name: m.name || m.file.replace(/\.(jar|zip)$/i, ''), file: m.file, url: m.url, sha256: m.sha256 }));
}

async function main() {
  console.log(`Mods lus dans : ${MODS_DIR}`);
  const mods = await readLocalFiles(MODS_DIR, '.jar', 'mod');
  const shaders = await readLocalFiles(SHADERS_DIR, '.zip', 'shader');
  const packs = orderResourcePacks(await readLocalFiles(RESOURCEPACKS_DIR, '.zip', 'resourcepack'));
  const all = [...mods, ...shaders, ...packs];
  const loaderVersion = await resolveLoaderVersion();
  await matchModrinth(all);

  const defaultShader = modpack.defaultShader || (shaders.length === 1 ? shaders[0].file : null);
  if (defaultShader && !shaders.some((s) => s.file === defaultShader)) {
    fail(`Le shader par défaut « ${defaultShader} » (modpack.json) n'est pas dans le dossier shaderpacks.`);
  }

  const manifest = {
    minecraftVersion: modpack.minecraftVersion,
    loader: { type: 'fabric', version: loaderVersion },
    launcherMinVersion: modpack.launcherMinVersion || '1.0.0',
    mods: [],
    shaderpacks: [],
    defaultShader,
    resourcepacks: [], // du haut vers le bas, comme dans le menu du jeu
  };
  const finish = () => {
    manifest.mods = toManifestEntries(mods);
    manifest.shaderpacks = toManifestEntries(shaders);
    manifest.resourcepacks = toManifestEntries(packs);
  };

  console.log(`\nMinecraft ${manifest.minecraftVersion}, Fabric ${loaderVersion}, ${mods.length} mod(s) :`);
  for (const m of mods) console.log(`  • ${m.file}${m.url ? '  [Modrinth]' : ''}`);
  if (shaders.length) {
    console.log(`${shaders.length} shader(s) :`);
    for (const s of shaders) console.log(`  • ${s.file}${s.url ? '  [Modrinth]' : ''}${s.file === defaultShader ? '  (activé par défaut)' : ''}`);
  }
  if (packs.length) {
    console.log(`${packs.length} pack(s) de textures, imposés dans cet ordre (haut → bas) :`);
    packs.forEach((p, i) => console.log(`  ${i + 1}. ${p.file}${p.url ? '  [Modrinth]' : ''}`));
  }
  console.log('');

  if (DRY_RUN) {
    for (const m of all) m.url = m.url || `https://github.com/${owner}/${repo}/releases/download/${TAG}/${encodeURIComponent(m.file)}`;
    finish();
    await fsp.mkdir(path.join(ROOT, 'dist'), { recursive: true });
    await fsp.writeFile(path.join(ROOT, 'dist', 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log('Mode essai : dist/manifest.json généré, rien n\'a été envoyé.');
  } else if (OUT_DIR) {
    await publishFolder(manifest, all, finish);
  } else {
    await publishGithub(manifest, all, finish);
  }
  console.log('\n✔ Terminé. Les joueurs recevront la mise à jour au prochain lancement.');
}

main().catch((err) => fail(err.stack || err.message));

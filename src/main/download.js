// Téléchargements : nouvelles tentatives, vérification d'empreinte, parallélisme et progression.
// Pas de dépendance à Electron : ce module fonctionne aussi dans Node seul.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { UserError, HttpError, isNetworkError } = require('./errors');

let userAgent = 'radhes-launcher';
const setUserAgent = (ua) => { userAgent = ua; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
      if (!res.ok) throw new HttpError(res.status, url);
      return res;
    } catch (err) {
      lastErr = err;
      const retryable = isNetworkError(err) || (err instanceof HttpError && (err.status >= 500 || err.status === 429));
      if (!retryable) break;
      await sleep(1000 * (i + 1));
    }
  }
  throw lastErr;
}

async function exists(file) {
  try { await fsp.access(file); return true; } catch { return false; }
}

function hashFile(file, algo) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')));
  });
}

// Télécharge du JSON et en garde une copie : si le réseau est coupé, on réutilise la copie.
async function fetchJsonCached(url, cacheFile) {
  try {
    const data = await (await fetchRetry(url)).json();
    await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
    await fsp.writeFile(cacheFile, JSON.stringify(data));
    return data;
  } catch (err) {
    if (await exists(cacheFile)) return JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
    throw err;
  }
}

// task = { url, dest, size?, sha1?, sha256? }
// Faut-il (re)télécharger ? En mode « approfondi », on vérifie l'empreinte en plus de la taille.
async function needsDownload(task, deep = false) {
  let stat;
  try { stat = await fsp.stat(task.dest); } catch { return true; }
  if (task.size != null && stat.size !== task.size) return true;
  if (deep || task.alwaysHash) {
    if (task.sha256) return (await hashFile(task.dest, 'sha256')) !== task.sha256.toLowerCase();
    if (task.sha1) return (await hashFile(task.dest, 'sha1')) !== task.sha1.toLowerCase();
  }
  return false;
}

async function downloadFile(task, onBytes) {
  await fsp.mkdir(path.dirname(task.dest), { recursive: true });
  const tmp = `${task.dest}.part`;
  const algo = task.sha256 ? 'sha256' : task.sha1 ? 'sha1' : null;
  const expected = (task.sha256 || task.sha1 || '').toLowerCase();

  for (let attempt = 1; ; attempt++) {
    const res = await fetchRetry(task.url);
    const hash = algo && crypto.createHash(algo);
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        if (hash) hash.update(chunk);
        if (onBytes) onBytes(chunk.length);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(tmp));

    if (!hash || hash.digest('hex') === expected) {
      await fsp.rename(tmp, task.dest);
      return;
    }
    await fsp.rm(tmp, { force: true });
    if (attempt >= 2) {
      throw new UserError(`Le fichier ${path.basename(task.dest)} est corrompu (empreinte incorrecte) après téléchargement.`);
    }
  }
}

// Télécharge les fichiers manquants d'une liste, en parallèle.
// onProgress({ done, total }) en octets (ou en nombre de fichiers si les tailles sont inconnues).
async function downloadAll(tasks, { deep = false, concurrency = 12, onProgress } = {}) {
  const todo = [];
  await runPool(tasks, 32, async (t) => { if (await needsDownload(t, deep)) todo.push(t); });
  if (!todo.length) return 0;

  const bySize = todo.every((t) => t.size != null);
  const total = bySize ? todo.reduce((s, t) => s + t.size, 0) : todo.length;
  let done = 0;
  let lastEmit = 0;
  const emit = (force) => {
    const now = Date.now();
    if (onProgress && (force || now - lastEmit > 100)) {
      lastEmit = now;
      onProgress({ done: Math.min(done, total), total });
    }
  };

  await runPool(todo, concurrency, async (t) => {
    await downloadFile(t, bySize ? (n) => { done += n; emit(); } : null);
    if (!bySize) { done += 1; emit(); }
  });
  emit(true);
  return todo.length;
}

async function runPool(items, limit, worker) {
  let index = 0;
  let failed = false;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && index < items.length) {
      const item = items[index++];
      try {
        await worker(item);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  });
  await Promise.all(runners);
}

module.exports = { setUserAgent, fetchRetry, fetchJsonCached, hashFile, needsDownload, downloadFile, downloadAll, exists };

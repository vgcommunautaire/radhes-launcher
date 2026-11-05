// Skin du joueur, lu depuis les serveurs officiels de Mojang (avec une copie locale pour le mode hors ligne).
const fsp = require('fs').promises;
const path = require('path');
const { HttpError } = require('./errors');
const { USER_AGENT } = require('./config');

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new HttpError(res.status, url);
  return res;
}

// Renvoie l'image complète du skin (data URL PNG), ou null si elle est introuvable.
async function getSkin(uuid, cacheDir) {
  const cacheFile = path.join(cacheDir, `skin-${uuid}.png`);
  try {
    const profile = await (await get(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`)).json();
    const textures = JSON.parse(Buffer.from(profile.properties.find((p) => p.name === 'textures').value, 'base64').toString());
    const url = textures.textures?.SKIN?.url;
    if (!url) return null;
    const png = Buffer.from(await (await get(url.replace(/^http:/, 'https:'))).arrayBuffer());
    await fsp.mkdir(cacheDir, { recursive: true });
    await fsp.writeFile(cacheFile, png);
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    try {
      return `data:image/png;base64,${(await fsp.readFile(cacheFile)).toString('base64')}`;
    } catch {
      return null;
    }
  }
}

module.exports = { getSkin };

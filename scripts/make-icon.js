// Génère l'icône du launcher (cœur en pixels) sans aucune dépendance :
//   build/icon.ico       → icône de l'installateur et du .exe (16 à 256 px)
//   src/assets/icon.png  → icône de la fenêtre (256 px)
// Utilisation : node scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

// Même cœur que dans l'interface (9 × 8 cases).
const HEART = [
  '.XX...XX.',
  'XXXX.XXXX',
  'XXXXXXXXX',
  'XXXXXXXXX',
  '.XXXXXXX.',
  '..XXXXX..',
  '...XXX...',
  '....X....',
];
const SHINE = new Set(['1,1', '2,1', '1,2']);

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const cell = Math.max(1, Math.floor((size * 0.66) / 9));
  const hw = cell * 9;
  const hh = cell * 8;
  const ox = Math.floor((size - hw) / 2);
  const oy = Math.floor((size - hh) / 2) + Math.round(cell * 0.3);
  const radius = size * 0.2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Fond : carré arrondi, lueur rouge au centre.
      const cx = Math.min(x + 0.5, size - x - 0.5);
      const cy = Math.min(y + 0.5, size - y - 0.5);
      let alpha = 1;
      if (cx < radius && cy < radius) {
        const d = Math.hypot(radius - cx, radius - cy);
        alpha = Math.max(0, Math.min(1, radius - d + 0.5));
      }
      const dist = Math.hypot(x - size / 2, y - size / 2) / (size * 0.7);
      let color = mix([74, 12, 15], [11, 7, 7], Math.min(1, dist));

      // Cœur.
      const gx = Math.floor((x - ox) / cell);
      const gy = Math.floor((y - oy) / cell);
      if (x >= ox && y >= oy && gx < 9 && gy < 8 && HEART[gy][gx] === 'X') {
        color = SHINE.has(`${gx},${gy}`) ? [255, 190, 190] : mix([255, 64, 64], [190, 20, 26], gy / 7);
      }

      const i = (y * size + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, px);
}

// --- Encodage PNG / ICO ----------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((size) => ({ size, data: render(size) }));
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'src', 'assets'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), encodeIco(pngs));
fs.writeFileSync(path.join(ROOT, 'src', 'assets', 'icon.png'), pngs.find((p) => p.size === 256).data);
console.log('Icône générée : build/icon.ico et src/assets/icon.png');

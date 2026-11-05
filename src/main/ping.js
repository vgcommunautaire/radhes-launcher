// État d'un serveur Minecraft (protocole « Server List Ping », celui de la liste des serveurs du jeu).
const net = require('net');
const dns = require('dns').promises;

function varint(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}

function readVarint(buf, offset) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) return null;
    const b = buf[offset + i];
    value |= (b & 0x7f) << (7 * i);
    if (!(b & 0x80)) return { value, size: i + 1 };
  }
  throw new Error('VarInt invalide');
}

const str = (s) => {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varint(b.length), b]);
};

function packet(id, ...parts) {
  const body = Buffer.concat([varint(id), ...parts]);
  return Buffer.concat([varint(body.length), body]);
}

// Texte brut d'une description (chaîne ou composant JSON), sans les codes couleur §.
function plainText(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c.replace(/§./g, '');
  return (plainText(c.text) + (c.extra || []).map(plainText).join('')).replace(/§./g, '');
}

async function resolve(address) {
  const [host, rawPort] = address.trim().split(':');
  if (rawPort) return { host, port: parseInt(rawPort, 10) };
  try {
    const [srv] = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (srv) return { host: srv.name, port: srv.port };
  } catch {}
  return { host, port: 25565 };
}

async function ping(address, timeoutMs = 5000) {
  const { host, port } = await resolve(address);
  return new Promise((resolvePing, reject) => {
    const socket = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    let status = null;
    let pingSentAt = 0;
    const fail = (err) => { socket.destroy(); reject(err); };
    socket.setTimeout(timeoutMs, () => fail(new Error('Délai dépassé')));
    socket.on('error', fail);

    socket.on('connect', () => {
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      socket.write(packet(0x00, varint(-1), str(host), portBuf, varint(1))); // poignée de main → état « status »
      socket.write(packet(0x00)); // demande d'état
    });

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len.size + len.value) return;
        const body = buf.subarray(len.size, len.size + len.value);
        buf = buf.subarray(len.size + len.value);
        const id = readVarint(body, 0);

        if (id.value === 0x00 && !status) {
          const strLen = readVarint(body, id.size);
          status = JSON.parse(body.subarray(id.size + strLen.size, id.size + strLen.size + strLen.value).toString('utf8'));
          const payload = Buffer.alloc(8);
          payload.writeBigInt64BE(BigInt(Date.now()));
          pingSentAt = Date.now();
          socket.write(packet(0x01, payload));
        } else if (id.value === 0x01 && status) {
          socket.end();
          resolvePing({
            online: status.players?.online ?? 0,
            max: status.players?.max ?? 0,
            motd: plainText(status.description).trim(),
            version: status.version?.name || '',
            latencyMs: Date.now() - pingSentAt,
          });
        }
      }
    });
  });
}

module.exports = { ping };

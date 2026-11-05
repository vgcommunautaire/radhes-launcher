const $ = (id) => document.getElementById(id);
const api = window.launcher;

const state = { account: null, playing: false, working: false, ramMb: 4096 };
const RAM_STEPS = [2, 3, 4, 6, 8, 10, 12, 16].map((g) => g * 1024);

// --- Pixel art -------------------------------------------------------------

// Dessine une grille de caractères en SVG : chaque lettre est une couleur de la palette, « . » est transparent.
function pixelSvg(rows, palette, inner = '') {
  let rects = '';
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '.') rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${palette[c]}"/>`;
  }));
  return `<svg viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges">${rects}${inner}</svg>`;
}

const ICONS = {
  play: [['w....', 'ww...', 'www..', 'wwww.', 'www..', 'ww...', 'w....'], { w: '#fff' }],
  back: [['w...w', 'w..ww', 'w.www', 'wwwww', 'w.www', 'w..ww', 'w...w'], { w: '#fff' }],
  ram: [['.y.y.y.y', 'gggggggg', 'gkkkkkkg', 'gkwwwwkg', 'gkwwwwkg', 'gkkkkkkg', 'gggggggg', '.y.y.y.y'],
    { g: '#2e7d32', k: '#1b1b1b', w: '#9e9e9e', y: '#d4af37' }],
  frame: [['bbbbbbbb', 'bssssssb', 'bssssysb', 'bssssssb', 'bsgssssb', 'bgggsggb', 'bGGggGGb', 'bbbbbbbb'],
    { b: '#7a4b25', s: '#6ec6ff', y: '#ffe14d', g: '#4caf50', G: '#2e7d32' }],
  sun: [['y..y..y.', '.y.y.y..', '..yyy...', 'yyyYyyy.', '..yyy...', '.y.y.y..', 'y..y..y.', '........'],
    { y: '#f5c518', Y: '#fff3a0' }],
  camera: [['..kk....', 'kkkkkkkk', 'kGGGGGrk', 'kGGbbGGk', 'kGbwwbGk', 'kGGbbGGk', 'kkkkkkkk', '........'],
    { k: '#2b2b2b', G: '#7a7a7a', b: '#1565c0', w: '#90caf9', r: '#e53935' }],
  wrench: [['.....w.w', '.....w.w', '....wwww', '...wwwd.', '..wwwd..', '.wwwd...', 'wwwd....', '.wd.....'],
    { w: '#d0d0d0', d: '#7d7d7d' }],
  paper: [['.wwwww..', '.wkkkw..', '.wwwww..', '.wkkww..', '.wwwww..', '.wkkkw..', '.wwwww..', '........'],
    { w: '#efe6d2', k: '#8d7b5a' }],
  note: [['...kkkkk', '...kkkkk', '...k...k', '...k...k', '.kkk.kkk', 'kkkkkkkk', '.kk..kk.', '........'],
    { k: '#b388ff' }],
  door: [['.dddddd.', '.dDDDDd.', '.dDDDDd.', '.dDDDyd.', '.dDDDDd.', '.dDDDDd.', '.dDDDDd.', '.dddddd.'],
    { d: '#5d3a1a', D: '#8b5a2b', y: '#ffd54f' }],
};

function fillIcons() {
  document.querySelectorAll('[data-icon]').forEach((el) => {
    const [rows, palette] = ICONS[el.dataset.icon];
    el.innerHTML = pixelSvg(rows, palette);
  });
}

// Cœur avec contour noir. Le remplissage est dans un groupe à part, pour l'effet demi-cœur.
const HEART_SHAPE = ['.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'];
function heartSvg() {
  const W = 11;
  const H = 10;
  const inHeart = (x, y) => HEART_SHAPE[y - 1]?.[x - 1] === 'X';
  let base = '';
  let fill = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = (color) => `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${color}"/>`;
      if (inHeart(x, y)) {
        base += r('#3a1215');
        const shine = (x === 2 && (y === 2 || y === 3)) || (x === 3 && y === 2);
        fill += r(shine ? '#ffc2c2' : y >= 6 ? '#b3161c' : '#e8262c');
      } else if ([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => inHeart(x + dx, y + dy))) {
        base += r('#120304');
      }
    }
  }
  return `<svg class="heart" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">${base}<g class="fill">${fill}</g></svg>`;
}

function buildHearts() {
  const box = $('hearts');
  for (let i = 0; i < 10; i++) {
    box.insertAdjacentHTML('beforeend', heartSvg());
    box.lastElementChild.style.setProperty('--i', i);
  }
  $('tb-heart').innerHTML = heartSvg();
  $('tb-heart').querySelector('.heart').classList.add('full');
}

// --- Sons (petits « bips » rétro générés, aucun fichier) -------------------

let audio = null;
let soundsOn = true;
try { soundsOn = localStorage.getItem('sounds') !== 'off'; } catch {}

function blip(freq = 660, duration = 0.07) {
  if (!soundsOn) return;
  try {
    audio = audio || new AudioContext();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + duration);
    gain.gain.setValueAtTime(0.035, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  } catch {}
}

// --- Navigation entre les écrans --------------------------------------------

function showView(name) {
  for (const v of ['home', 'rules', 'settings']) $(`view-${v}`).hidden = v !== name;
  if (name === 'home') refreshServer();
}

// --- Rendu de l'accueil -----------------------------------------------------

function render() {
  const { account, playing, working } = state;
  $('login').hidden = !!account;
  $('play').hidden = !account;
  $('play').disabled = working || playing;
  $('play').classList.toggle('playing', playing);
  $('play-label').textContent = playing ? 'EN JEU' : 'JOUER';
  $('login').disabled = working;
  $('progress').hidden = !working;
  $('verify').disabled = working || playing || !account;
  $('logout').hidden = !account;

  $('account-name').textContent = account ? account.name.toUpperCase() : 'INVITÉ';
  const status = $('account-status');
  status.textContent = !account ? 'Non connecté' : playing ? 'En jeu' : working ? 'Préparation...' : 'Prêt à jouer';
  status.className = `account-status ${!account ? '' : playing || working ? 'busy' : 'ok'}`;
}

function showError(message) {
  $('error').textContent = message || '';
  $('error').hidden = !message;
}

function setProgress({ label, percent }) {
  $('progress-label').textContent = label + (percent != null ? ` ${Math.floor(percent)} %` : '');
  const box = $('hearts');
  box.classList.toggle('waiting', percent == null);
  const halves = percent == null ? 0 : Math.floor(percent / 5);
  box.querySelectorAll('.heart').forEach((h, i) => {
    h.classList.toggle('full', halves >= (i + 1) * 2);
    h.classList.toggle('half', halves === i * 2 + 1);
  });
}

// Tête du skin (visage + couche du chapeau), dessinée en gros pixels.
async function drawHead() {
  const canvas = $('head');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 64, 64);
  const res = state.account ? await api.getSkin() : null;
  if (!res?.ok || !res.skin) {
    ctx.fillStyle = '#3a3440';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#1c1a20';
    ctx.fillRect(16, 24, 8, 8);
    ctx.fillRect(40, 24, 8, 8);
    ctx.fillRect(24, 44, 16, 6);
    return;
  }
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
    // Comme le jeu : la couche « chapeau » est ignorée si elle est entièrement opaque (vieux skins).
    const probe = document.createElement('canvas');
    probe.width = 8;
    probe.height = 8;
    const p = probe.getContext('2d');
    p.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
    const alpha = p.getImageData(0, 0, 8, 8).data.filter((_, i) => i % 4 === 3);
    if (alpha.some((a) => a < 255)) ctx.drawImage(probe, 0, 0, 8, 8, 0, 0, 64, 64);
  };
  img.src = res.skin;
}

async function refreshServer() {
  const res = await api.getServer();
  if (!res.ok) return;
  const card = $('server-card');
  $('server-name').textContent = res.name;
  card.classList.toggle('online', res.configured && res.reachable);
  card.classList.toggle('offline', res.configured && !res.reachable);
  if (!res.configured) {
    $('server-state').textContent = 'BIENTÔT';
    $('server-motd').textContent = 'Le serveur arrive bientôt';
    $('players-count').textContent = '-';
    $('players-line').textContent = 'en préparation';
    $('players-max').textContent = '';
    $('server-ping').textContent = '';
  } else if (!res.reachable) {
    $('server-state').textContent = 'HORS LIGNE';
    $('server-motd').textContent = 'Le serveur ne répond pas';
    $('players-count').textContent = '0';
    $('players-line').textContent = 'joueur en ligne';
    $('players-max').textContent = '';
    $('server-ping').textContent = '';
  } else {
    $('server-state').textContent = 'EN LIGNE';
    $('server-motd').textContent = res.motd || 'Survie hardcore · vie partagée';
    $('players-count').textContent = String(res.online);
    $('players-line').textContent = res.online > 1 ? 'joueurs en ligne' : 'joueur en ligne';
    $('players-max').textContent = `sur ${res.max} places`;
    $('server-ping').textContent = `${res.latencyMs} ms`;
  }
}

async function refreshPack() {
  const res = await api.getPack();
  if (!res.ok) {
    $('pack-title').textContent = 'MINECRAFT';
    $('pack-sub').textContent = 'Liste des mods pas encore publiée';
    $('pack-state').textContent = 'EN ATTENTE';
    return;
  }
  $('pack-title').textContent = `MINECRAFT ${res.minecraftVersion}`;
  $('pack-sub').textContent = `Fabric ${res.loaderVersion} · ${res.modCount} mod${res.modCount > 1 ? 's' : ''}`;
  $('pack-state').textContent = 'SYNCHRONISÉ';
}

// --- Règles du jeu (les mêmes que dans le mod) -------------------------------

const RULES = [
  ['VIE PARTAGÉE', 'red', "Toute l'équipe partage une seule barre de 10 cœurs. Chaque dégât subi par l'un de vous est retiré à tous."],
  ['SOINS', 'green', "Potions et pommes d'or soignent aussitôt. Sinon, toute l'équipe doit avoir la faim pleine."],
  ['VICTOIRE', 'yellow', "Vaincre l'Ender Dragon. Il est plus coriace que d'habitude : préparez-vous bien."],
  ['DÉFAITE', 'red', 'Vie commune à zéro : la partie est perdue, et tout recommence dans un nouveau monde.'],
  ['QUÊTES', 'cyan', 'Libres : la première personne qui en remplit une la remporte. Plus le rang est haut, plus elle rapporte.'],
  ['RANGS', 'cyan', 'Ton rang monte avec ce que tu accomplis, et chaque nouveau rang rapporte. Il repart de zéro à chaque partie.'],
  ['SPÉCIALISATIONS', 'purple', 'Plus tu pratiques une activité, plus tu deviens bon. À toi de découvrir lesquelles.'],
  ['BOUTIQUE', 'yellow', 'Elle ouvre au rang C. Chaque point gagné rapporte une pièce, pour toi ou l\'équipe. Ton score reste intact.'],
  ['CLASSEMENT', 'yellow', 'À la fin de chaque partie, tout le monde est classé selon ses points. Les cœurs perdus en coûtent.'],
  ['ENTRAIDE', 'purple', 'Une seule vie pour tous : restez groupés, partagez la nourriture, et ne laissez personne derrière.'],
];

// Carte « Le savais-tu ? » : fait défiler les règles sur l'accueil.
function startTips() {
  let i = Math.floor(Math.random() * RULES.length);
  const show = () => {
    const [title, color, text] = RULES[i % RULES.length];
    const card = $('tip-card');
    card.classList.remove('tip-in');
    void card.offsetWidth; // relance l'animation
    card.classList.add('tip-in');
    card.style.setProperty('--c', `var(--${color})`);
    $('tip-title').textContent = title;
    $('tip-text').textContent = text;
    i++;
  };
  show();
  setInterval(show, 9000);
}

function buildRules() {
  const box = $('rules');
  for (const [title, color, text] of RULES) {
    const card = document.createElement('div');
    card.className = `rule accent-${color}`;
    card.innerHTML = '<h3></h3><p></p>';
    card.querySelector('h3').textContent = title;
    card.querySelector('p').textContent = text;
    box.appendChild(card);
  }
}

// --- Braises en pixels ------------------------------------------------------

function startEmbers() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = $('embers');
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  const resize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
  resize();
  window.addEventListener('resize', resize);
  const spawn = (anywhere) => ({
    x: Math.random() * w, y: anywhere ? Math.random() * h : h + 6,
    s: Math.random() < 0.8 ? 2 : 3, vy: 0.2 + Math.random() * 0.6, phase: Math.random() * 6.3,
    hue: Math.random() * 22, life: 0.35 + Math.random() * 0.65,
  });
  const embers = Array.from({ length: 80 }, () => spawn(true));
  const tick = (t) => {
    ctx.clearRect(0, 0, w, h);
    for (const e of embers) {
      e.y -= e.vy;
      e.x += Math.sin(t / 1100 + e.phase) * 0.25;
      const a = Math.max(0, Math.min(1, e.y / h)) * e.life * (0.6 + 0.4 * Math.sin(t / 260 + e.phase));
      ctx.fillStyle = `hsla(${e.hue}, 95%, 52%, ${a})`;
      ctx.fillRect(Math.round(e.x), Math.round(e.y), e.s, e.s);
      if (e.y < -6) Object.assign(e, spawn(false));
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// --- Actions ---------------------------------------------------------------

async function play(deep) {
  showView('home');
  showError(null);
  state.working = true;
  setProgress({ label: 'Préparation...', percent: null });
  render();
  const res = await api.play({ deep });
  state.working = false;
  if (!res.ok) {
    showError(res.error);
    const s = await api.getState();
    if (s.ok) state.account = s.account;
  }
  render();
}

function setRam(mb) {
  state.ramMb = mb;
  $('ram-value').textContent = `${mb / 1024} Go`;
}

function stepRam(dir) {
  const i = RAM_STEPS.findIndex((v) => v >= state.ramMb);
  const next = RAM_STEPS[Math.max(0, Math.min(RAM_STEPS.length - 1, (i === -1 ? RAM_STEPS.length - 1 : i) + dir))];
  setRam(next);
  api.saveSettings({ ramMb: next });
}

function renderSounds() {
  $('sounds-sub').textContent = soundsOn ? 'Activés' : 'Désactivés';
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  blip(btn.classList.contains('btn-big') ? 440 : 700);
  if (btn.dataset.view) showView(btn.dataset.view);
  if (btn.dataset.folder) api.openFolder(btn.dataset.folder);
});

$('play').addEventListener('click', () => play(false));
$('verify').addEventListener('click', () => play(true));
$('quit').addEventListener('click', () => api.quit());
$('ram-down').addEventListener('click', () => stepRam(-1));
$('ram-up').addEventListener('click', () => stepRam(1));
$('sounds').addEventListener('click', () => {
  soundsOn = !soundsOn;
  try { localStorage.setItem('sounds', soundsOn ? 'on' : 'off'); } catch {}
  renderSounds();
  blip(880);
});

$('login').addEventListener('click', async () => {
  showError(null);
  state.working = true;
  render();
  $('account-status').textContent = 'Connexion en cours...';
  const res = await api.login();
  state.working = false;
  if (res.ok) {
    state.account = res.account;
    drawHead();
  } else {
    showError(res.error);
  }
  render();
});

$('logout').addEventListener('click', async () => {
  await api.logout();
  state.account = null;
  showError(null);
  drawHead();
  render();
  showView('home');
});

api.on('progress', setProgress);

api.on('game', ({ state: s, error }) => {
  state.playing = s === 'running';
  if (error) showError(error);
  render();
});

api.on('update', (u) => {
  const banner = $('update-banner');
  const messages = {
    downloading: `Mise à jour du launcher${u.version ? ` ${u.version}` : ''}${u.percent ? ` : ${Math.floor(u.percent)} %` : '...'}`,
    installing: `Mise à jour ${u.version} prête : redémarrage...`,
    'ready-later': `Mise à jour ${u.version} installée à la fermeture`,
  };
  banner.textContent = messages[u.state] || '';
  banner.hidden = !messages[u.state];
});

// --- Démarrage --------------------------------------------------------------

fillIcons();
buildHearts();
buildRules();
startTips();
renderSounds();
startEmbers();
render();

(async () => {
  const s = await api.getState();
  if (!s.ok) {
    showError(s.error);
    return;
  }
  $('version').textContent = `v${s.version}`;
  state.account = s.account;
  state.playing = s.playing;
  setRam(s.settings.ramMb);
  if (s.warning) showError(s.warning);
  render();
  drawHead();
  refreshPack();
  refreshServer();
  setInterval(() => { if (!$('view-home').hidden) refreshServer(); }, 30000);
})();

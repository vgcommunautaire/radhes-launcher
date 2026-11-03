const $ = (id) => document.getElementById(id);
const api = window.launcher;

let state = { account: null, playing: false, working: false };

const HEART_COUNT = 10;

function buildHearts() {
  const box = $('hearts');
  for (let i = 0; i < HEART_COUNT; i++) {
    box.insertAdjacentHTML('beforeend',
      `<svg class="heart" viewBox="0 0 9 8" style="--i:${i}"><use href="#heart" class="empty"/><use href="#heart" class="fill"/><use href="#heart-shine" class="shine"/></svg>`);
  }
}

function render() {
  const { account, playing, working } = state;
  $('account-box').hidden = !account;
  $('account-name').textContent = account ? account.name : '';
  $('avatar').textContent = account ? account.name.charAt(0).toUpperCase() : '';
  $('logout').hidden = !account || working || playing;
  $('login').hidden = !!account;
  $('play').hidden = !account;
  $('play').disabled = working || playing;
  $('play').textContent = playing ? 'EN JEU' : 'JOUER';
  $('login').disabled = working;
  $('verify').disabled = working || playing || !account;
  $('progress').hidden = !working;
}

function showError(message) {
  $('error').textContent = message || '';
  $('error').hidden = !message;
}

function setStatus(text) {
  $('status').textContent = text || '';
}

function setProgress({ label, percent }) {
  $('progress-label').textContent = label + (percent != null ? ` ${Math.floor(percent)} %` : '');
  // Chaque cœur vaut 10 % ; un demi-cœur, 5 %.
  const box = $('hearts');
  box.classList.toggle('waiting', percent == null);
  const halves = percent == null ? 0 : Math.floor(percent / (50 / HEART_COUNT));
  box.querySelectorAll('.heart').forEach((h, i) => {
    h.classList.toggle('full', halves >= (i + 1) * 2);
    h.classList.toggle('half', halves === i * 2 + 1);
  });
}

// Braises qui montent dans le fond.
function startEmbers() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = $('embers');
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  const resize = () => {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize);

  const spawn = (anywhere) => ({
    x: Math.random() * w,
    y: anywhere ? Math.random() * h : h + 10,
    r: 0.6 + Math.random() * 2,
    vy: 0.3 + Math.random() * 0.9,
    vx: (Math.random() - 0.5) * 0.3,
    hue: 5 + Math.random() * 30,
    life: 0.4 + Math.random() * 0.6,
    phase: Math.random() * Math.PI * 2,
  });
  const embers = Array.from({ length: 70 }, () => spawn(true));

  const tick = (t) => {
    ctx.clearRect(0, 0, w, h);
    for (const e of embers) {
      e.y -= e.vy;
      e.x += e.vx + Math.sin(t / 900 + e.phase) * 0.2;
      const alpha = Math.max(0, Math.min(1, e.y / h)) * e.life * (0.7 + 0.3 * Math.sin(t / 200 + e.phase));
      ctx.beginPath();
      ctx.fillStyle = `hsla(${e.hue}, 100%, 58%, ${alpha})`;
      ctx.shadowColor = `hsla(${e.hue}, 100%, 50%, ${alpha})`;
      ctx.shadowBlur = 8;
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
      if (e.y < -10) Object.assign(e, spawn(false));
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function fillRamOptions(selected) {
  const select = $('ram');
  select.innerHTML = '';
  for (const gb of [2, 3, 4, 6, 8, 10, 12, 16]) {
    const opt = document.createElement('option');
    opt.value = gb * 1024;
    opt.textContent = `${gb} Go`;
    select.appendChild(opt);
  }
  select.value = String(selected);
}

async function play(deep) {
  showError(null);
  state.working = true;
  setStatus('');
  setProgress({ label: 'Préparation...', percent: null });
  render();
  const res = await api.play({ deep });
  state.working = false;
  if (!res.ok) {
    showError(res.error);
    // La session a peut-être été effacée (expirée) : on recharge l'état.
    const s = await api.getState();
    if (s.ok) state.account = s.account;
  }
  render();
}

$('login').addEventListener('click', async () => {
  showError(null);
  state.working = true;
  setStatus('Connexion en cours, termine-la dans la fenêtre Microsoft...');
  render();
  const res = await api.login();
  state.working = false;
  setStatus('');
  if (res.ok) state.account = res.account;
  else showError(res.error);
  render();
});

$('logout').addEventListener('click', async () => {
  await api.logout();
  state.account = null;
  showError(null);
  render();
});

$('play').addEventListener('click', () => play(false));
$('verify').addEventListener('click', () => play(true));
$('open-game').addEventListener('click', () => api.openFolder('game'));
$('open-logs').addEventListener('click', () => api.openFolder('logs'));
$('ram').addEventListener('change', (e) => api.saveSettings({ ramMb: e.target.value }));

api.on('progress', setProgress);

api.on('game', ({ state: s, error }) => {
  state.playing = s === 'running';
  setStatus(s === 'running' ? 'Le jeu est lancé. Bon jeu !' : '');
  if (error) showError(error);
  render();
});

api.on('update', (u) => {
  const banner = $('update-banner');
  const messages = {
    downloading: `Mise à jour du launcher${u.version ? ` (${u.version})` : ''} en cours de téléchargement${u.percent ? ` : ${Math.floor(u.percent)} %` : '...'}`,
    installing: `Mise à jour ${u.version} prête : le launcher va redémarrer pour l'installer...`,
    'ready-later': `Mise à jour ${u.version} prête : elle sera installée à la fermeture du launcher.`,
  };
  banner.textContent = messages[u.state] || '';
  banner.hidden = !messages[u.state];
});

buildHearts();
startEmbers();

(async () => {
  const s = await api.getState();
  if (!s.ok) {
    showError(s.error);
    return;
  }
  $('version').textContent = `Version ${s.version}`;
  state.account = s.account;
  state.playing = s.playing;
  fillRamOptions(s.settings.ramMb);
  if (s.warning) showError(s.warning);
  render();
})();

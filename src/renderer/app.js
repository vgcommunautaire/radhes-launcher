const $ = (id) => document.getElementById(id);
const api = window.launcher;

let state = { account: null, playing: false, working: false };

function render() {
  const { account, playing, working } = state;
  $('account-name').textContent = account ? account.name : '';
  $('logout').hidden = !account || working || playing;
  $('login').hidden = !!account;
  $('play').hidden = !account;
  $('play').disabled = working || playing;
  $('play').textContent = playing ? 'En jeu' : 'Jouer';
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
  const fill = $('bar-fill');
  fill.classList.toggle('indeterminate', percent == null);
  fill.style.width = percent == null ? '' : `${percent}%`;
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

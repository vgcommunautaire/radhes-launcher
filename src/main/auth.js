// Connexion : Microsoft (OAuth 2 + PKCE) → Xbox Live → XSTS → Minecraft.
const { BrowserWindow } = require('electron');
const crypto = require('crypto');
const { AZURE_CLIENT_ID, USER_AGENT } = require('./config');
const { UserError, HttpError } = require('./errors');
const store = require('./store');
const log = require('./logger');

const MS_AUTHORIZE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const MS_TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const SCOPE = 'XboxLive.signin offline_access';

const XBL_AUTH = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTH = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile';

// On rafraîchit le jeton Minecraft (valable 24 h) s'il expire dans moins de 30 minutes.
const REFRESH_MARGIN_MS = 30 * 60 * 1000;

const XSTS_ERRORS = {
  2148916233: 'Ce compte Microsoft n\'a pas de profil Xbox. Connecte-toi une fois sur minecraft.net pour le créer, puis réessaie.',
  2148916235: 'Xbox Live n\'est pas disponible dans le pays de ce compte.',
  2148916236: 'Ce compte doit d\'abord valider son âge sur le site Xbox.',
  2148916237: 'Ce compte doit d\'abord valider son âge sur le site Xbox.',
  2148916238: 'Compte mineur : un adulte doit l\'ajouter à une famille Microsoft avant de pouvoir jouer.',
};

async function request(url, { method = 'POST', form, json, token } = {}) {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
  let body;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(form);
  } else if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) throw new HttpError(res.status, url, data);
  return data;
}

// --- Étape 1 : fenêtre de connexion Microsoft -----------------------------

function askAuthorizationCode(parent) {
  if (/^0{8}-/.test(AZURE_CLIENT_ID)) {
    return Promise.reject(new UserError('Le launcher n\'est pas configuré : l\'identifiant client Azure manque dans src/main/config.js.'));
  }
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('base64url');

  const url = new URL(MS_AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: AZURE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();

  return new Promise((resolve, reject) => {
    let finished = false;
    const win = new BrowserWindow({
      parent,
      modal: true,
      width: 520,
      height: 680,
      title: 'Connexion Microsoft',
      autoHideMenuBar: true,
      webPreferences: { partition: 'msauth', contextIsolation: true, sandbox: true },
    });

    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      fn(value);
      if (!win.isDestroyed()) win.close();
    };

    const onNavigate = (event, legacyUrl) => {
      const target = event.url || legacyUrl;
      if (!target || !target.startsWith(REDIRECT_URI)) return;
      event.preventDefault();
      const params = new URL(target).searchParams;
      const error = params.get('error');
      if (error) {
        const details = Object.fromEntries([...params].filter(([k]) => k !== 'code' && k !== 'state'));
        log.warn('Connexion Microsoft refusée :', details);
      }
      if (error === 'access_denied') return finish(reject, new UserError('Connexion annulée.'));
      if (error) return finish(reject, new UserError(`Microsoft a refusé la connexion : ${params.get('error_description') || error}`));
      if (params.get('state') !== state) return finish(reject, new UserError('Réponse de connexion invalide, réessaie.'));
      finish(resolve, { code: params.get('code'), verifier });
    };

    win.webContents.on('will-redirect', onNavigate);
    win.webContents.on('will-navigate', onNavigate);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => finish(reject, new UserError('Fenêtre de connexion fermée avant la fin.')));
    win.loadURL(url.toString()).catch(() => {}); // l'interception de la redirection annule le chargement
  });
}

async function microsoftToken(params) {
  try {
    return await request(MS_TOKEN, {
      form: { client_id: AZURE_CLIENT_ID, scope: SCOPE, redirect_uri: REDIRECT_URI, ...params },
    });
  } catch (err) {
    if (err instanceof HttpError && err.body?.error === 'invalid_grant') {
      throw new UserError('Ta session Microsoft a expiré. Reconnecte-toi.', { cause: err });
    }
    if (err instanceof HttpError && err.body?.error) {
      throw new UserError(`Erreur Microsoft : ${err.body.error_description || err.body.error}`, { cause: err });
    }
    throw err;
  }
}

// --- Étapes 2 à 4 : Xbox Live, XSTS, Minecraft ---------------------------

async function xboxChain(msAccessToken) {
  const xbl = await request(XBL_AUTH, {
    json: {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    },
  });

  let xsts;
  try {
    xsts = await request(XSTS_AUTH, {
      json: {
        Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT',
      },
    });
  } catch (err) {
    const xerr = err.body?.XErr;
    if (xerr) throw new UserError(XSTS_ERRORS[xerr] || `Xbox Live a refusé la connexion (code ${xerr}).`, { cause: err });
    throw err;
  }
  const uhs = xsts.DisplayClaims.xui[0].uhs;

  let mc;
  try {
    mc = await request(MC_LOGIN, { json: { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` } });
  } catch (err) {
    if (err instanceof HttpError && err.status === 403) {
      throw new UserError(
        'Mojang a refusé la connexion : l\'application Azure de ce launcher n\'est pas (encore) autorisée à utiliser l\'API Minecraft. Le propriétaire du launcher doit faire valider son identifiant client auprès de Microsoft.',
        { cause: err },
      );
    }
    if (err instanceof HttpError && err.status === 429) {
      throw new UserError('Trop de tentatives de connexion. Attends quelques minutes puis réessaie.', { cause: err });
    }
    throw err;
  }

  let profile;
  try {
    profile = await request(MC_PROFILE, { method: 'GET', token: mc.access_token });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new UserError(
        'Ce compte ne possède pas Minecraft Java Edition (ou n\'a pas encore choisi de pseudo sur minecraft.net).',
        { cause: err },
      );
    }
    throw err;
  }

  return {
    mcAccessToken: mc.access_token,
    mcExpiresAt: Date.now() + mc.expires_in * 1000,
    xuid: readXuid(mc.access_token),
    profile: { id: profile.id, name: profile.name },
  };
}

function readXuid(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).xuid || '0';
  } catch {
    return '0';
  }
}

async function sessionFromMicrosoft(ms) {
  const mc = await xboxChain(ms.access_token);
  const session = { msRefreshToken: ms.refresh_token, ...mc };
  store.saveSession(session);
  log.info(`Session Minecraft obtenue pour ${mc.profile.name}`);
  return session;
}

// --- API publique ---------------------------------------------------------

async function login(parentWindow) {
  const { code, verifier } = await askAuthorizationCode(parentWindow);
  const ms = await microsoftToken({ grant_type: 'authorization_code', code, code_verifier: verifier });
  return sessionFromMicrosoft(ms);
}

// Renvoie une session valide (rafraîchie si nécessaire), ou null si personne n'est connecté.
async function getFreshSession() {
  const session = store.loadSession();
  if (!session) return null;
  if (session.mcExpiresAt - Date.now() > REFRESH_MARGIN_MS) return session;

  log.info('Jeton Minecraft expiré ou bientôt expiré, rafraîchissement...');
  try {
    const ms = await microsoftToken({ grant_type: 'refresh_token', refresh_token: session.msRefreshToken });
    return await sessionFromMicrosoft(ms);
  } catch (err) {
    // Jeton de rafraîchissement refusé : on oublie la session. Erreur réseau : on la garde.
    if (err instanceof UserError) store.clearSession();
    throw err;
  }
}

function logout() {
  store.clearSession();
}

module.exports = { login, logout, getFreshSession };

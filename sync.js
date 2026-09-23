const KEY_STORAGE = 'mon-jardin-sync-key-v1';
const ETAG_STORAGE = 'mon-jardin-sync-etag-v1';
const DIRTY_STORAGE = 'mon-jardin-sync-dirty-v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const $ = (selector) => document.querySelector(selector);
let secret = localStorage.getItem(KEY_STORAGE) || '';
let etag = localStorage.getItem(ETAG_STORAGE) || '';
let dirty = localStorage.getItem(DIRTY_STORAGE) === '1';
let getPlants;
let applyPlants;
let running = null;
let timer;

function status(message) { $('#sync-status').textContent = message; }
function setDirty(value) {
  dirty = value;
  if (value) localStorage.setItem(DIRTY_STORAGE, '1');
  else localStorage.removeItem(DIRTY_STORAGE);
}
function setEtag(value) {
  etag = value || '';
  if (etag) localStorage.setItem(ETAG_STORAGE, etag);
  else localStorage.removeItem(ETAG_STORAGE);
}
function base64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function fromBase64url(value) {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function encryptionKey(token) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(`mon-jardin:aes:${token}`));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encrypt(plants, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(token), encoder.encode(JSON.stringify(plants)));
  return JSON.stringify({ v: 1, iv: base64url(iv), data: base64url(new Uint8Array(data)) });
}
async function decrypt(payload, token) {
  const item = JSON.parse(payload);
  if (item.v !== 1) throw new Error('Format de sauvegarde inconnu.');
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(item.iv) }, await encryptionKey(token), fromBase64url(item.data));
  const plants = JSON.parse(decoder.decode(data));
  if (!Array.isArray(plants) || plants.some((plant) => !plant?.id || !plant?.name)) throw new Error('Données de plantes invalides.');
  return plants;
}
async function request(method, token, body, version) {
  const headers = { Authorization: `Bearer ${token}` };
  if (method === 'PUT') {
    headers['Content-Type'] = 'application/json';
    headers[version ? 'If-Match' : 'If-None-Match'] = version || '*';
  }
  const response = await fetch('/api/sync', { method, headers, body, cache: 'no-store' });
  if (![200, 404, 409].includes(response.status)) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `Erreur de synchronisation (${response.status}).`);
  }
  return response;
}
async function upload() {
  const snapshot = JSON.stringify(getPlants());
  const response = await request('PUT', secret, await encrypt(JSON.parse(snapshot), secret), etag);
  if (response.status === 409) {
    status('Conflit : le cloud a changé sur un autre appareil. Tes modifications restent sur cet appareil. Déconnecte puis reconnecte la clé pour choisir la version à conserver.');
    return;
  }
  setEtag(response.headers.get('ETag'));
  if (JSON.stringify(getPlants()) === snapshot) { setDirty(false); status('Toutes tes plantes sont synchronisées.'); }
  else { setDirty(true); schedule(); }
}
async function synchronize() {
  if (!secret) { status('Crée ou colle une clé pour activer la synchronisation.'); return; }
  if (running) return running;
  running = (async () => {
    status('Synchronisation en cours…');
    try {
      const response = await request('GET', secret);
      const remoteEtag = response.status === 404 ? '' : response.headers.get('ETag');
      if (dirty) {
        if (remoteEtag !== etag) {
          status('Conflit : le cloud a changé pendant que cet appareil était hors ligne. Rien n’a été écrasé. Déconnecte puis reconnecte la clé pour choisir la version.');
          return;
        }
        await upload();
      } else if (response.status === 200 && remoteEtag !== etag) {
        const remote = await decrypt(await response.text(), secret);
        if (dirty) { schedule(); return; }
        applyPlants(remote);
        setEtag(remoteEtag);
        status('Plantes récupérées depuis le cloud.');
      } else if (response.status === 404) {
        setDirty(true);
        await upload();
      } else status('Toutes tes plantes sont synchronisées.');
    } catch (error) { status(`Synchronisation impossible : ${error.message}`); }
  })();
  try { await running; } finally { running = null; }
}
function schedule() { clearTimeout(timer); timer = setTimeout(() => { void synchronize(); }, 800); }

export function syncOnChange() {
  if (!secret) return;
  setDirty(true);
  status('Modifications en attente de synchronisation…');
  schedule();
}

export function initSync(handlers) {
  getPlants = handlers.getPlants;
  applyPlants = handlers.applyPlants;
  $('#sync-open').addEventListener('click', () => {
    $('#sync-key').value = secret;
    $('#sync-dialog').showModal();
    status(secret ? (dirty ? 'Modifications en attente.' : 'Clé connectée à cet appareil.') : 'Aucune clé connectée.');
  });
  $('#sync-close').addEventListener('click', () => $('#sync-dialog').close());
  $('#sync-dialog').addEventListener('click', (event) => { if (event.target === $('#sync-dialog')) $('#sync-dialog').close(); });
  $('#sync-connect').addEventListener('click', async () => {
    if (running) return;
    const token = $('#sync-key').value.trim() || base64url(crypto.getRandomValues(new Uint8Array(32)));
    $('#sync-key').value = token;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { status('Cette clé est invalide. Colle la clé complète.'); return; }
    status('Connexion en cours…');
    try {
      const response = await request('GET', token);
      if (response.status === 200) {
        const remote = await decrypt(await response.text(), token);
        if (getPlants().length && JSON.stringify(getPlants()) !== JSON.stringify(remote) &&
          !confirm('Le cloud contient déjà des plantes. Remplacer les plantes présentes sur cet appareil par celles du cloud ? Cette action efface les changements locaux non synchronisés.')) {
          status('Connexion annulée. Les plantes locales sont conservées.'); return;
        }
        applyPlants(remote);
        secret = token;
        localStorage.setItem(KEY_STORAGE, token);
        setEtag(response.headers.get('ETag'));
        setDirty(false);
        status('Connecté : plantes récupérées depuis le cloud. Copie la clé pour tes autres appareils.');
      } else {
        secret = token;
        localStorage.setItem(KEY_STORAGE, token);
        setEtag('');
        setDirty(true);
        await upload();
        status('Clé créée. Copie-la pour connecter tes autres appareils.');
      }
    } catch (error) { status(`Connexion impossible : ${error.message}`); }
  });
  $('#sync-copy').addEventListener('click', async () => {
    if (!secret) { status('Connecte d’abord une clé.'); return; }
    try { await navigator.clipboard.writeText(secret); status('Clé copiée. Conserve-la en lieu sûr.'); }
    catch { status('Copie la clé affichée dans le champ ci-dessus.'); }
  });
  $('#sync-now').addEventListener('click', () => { void synchronize(); });
  $('#sync-disconnect').addEventListener('click', () => {
    if (!secret) return;
    secret = '';
    localStorage.removeItem(KEY_STORAGE);
    setEtag(''); setDirty(false);
    $('#sync-key').value = '';
    status('Cet appareil est déconnecté. Ses plantes restent enregistrées localement.');
  });
  window.addEventListener('online', () => { void synchronize(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void synchronize(); });
  if (secret) void synchronize();
}

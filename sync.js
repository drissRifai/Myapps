const KEY_STORAGE = 'mon-jardin-sync-key-v1';
const ETAG_STORAGE = 'mon-jardin-sync-etag-v1';
const DIRTY_STORAGE = 'mon-jardin-sync-dirty-v1';
const PENDING_STORAGE = 'mon-jardin-sync-pending-v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const $ = (selector) => document.querySelector(selector);
let secret = localStorage.getItem(KEY_STORAGE) || '';
let etag = localStorage.getItem(ETAG_STORAGE) || '';
let dirty = localStorage.getItem(DIRTY_STORAGE) === '1';
let pending = (() => {
  try {
    const data = JSON.parse(localStorage.getItem(PENDING_STORAGE) || '{}');
    return { profiles: Array.isArray(data.profiles) ? data.profiles : [], plants: Array.isArray(data.plants) ? data.plants : [] };
  } catch { return { profiles: [], plants: [] }; }
})();
let editSerial = 0;
let getPlants;
let applyPlants;
let hasData;
let running = null;
let timer;
let needsRerun = false;
let rerunDelay = 100;

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
function setPending(next) {
  pending = next;
  if (next.profiles.length || next.plants.length) localStorage.setItem(PENDING_STORAGE, JSON.stringify(next));
  else localStorage.removeItem(PENDING_STORAGE);
}
function gardenFrom(snapshot) {
  if (Array.isArray(snapshot)) return { version: 2, profiles: [{ id: 'principal', name: 'Principal', plants: snapshot }] };
  return snapshot;
}
function mergeGardens(remoteSnapshot, localSnapshot, changes) {
  const remote = gardenFrom(remoteSnapshot);
  const local = gardenFrom(localSnapshot);
  const changedProfiles = new Set(changes.profiles);
  const changedPlants = new Set(changes.plants);
  // Une ancienne version déjà en attente ne conservait pas le détail des modifications.
  const legacyPending = dirty && !changedProfiles.size && !changedPlants.size;
  const profiles = new Map(remote.profiles.map((profile) => [profile.id, { ...profile, plants: [...profile.plants] }]));
  for (const profile of local.profiles) {
    const target = profiles.get(profile.id);
    if (!target) { profiles.set(profile.id, profile); continue; }
    if (changedProfiles.has(profile.id)) target.name = profile.name;
    const plants = new Map(target.plants.map((plant) => [plant.id, plant]));
    for (const plant of profile.plants) {
      if (changedPlants.has(`${profile.id}:${plant.id}`)) plants.set(plant.id, plant);
      else if (legacyPending && !plants.has(plant.id)) plants.set(plant.id, plant);
      else if (legacyPending && JSON.stringify(plants.get(plant.id)) !== JSON.stringify(plant)) {
        // Une ancienne version en attente n'identifiait pas la plante modifiée : conserver les deux variantes.
        const copy = { ...plant, id: crypto.randomUUID(), name: `${plant.name} (copie locale)` };
        plants.set(copy.id, copy);
      }
    }
    for (const key of changedPlants) {
      if (!key.startsWith(`${profile.id}:`)) continue;
      const id = key.slice(profile.id.length + 1);
      if (!profile.plants.some((plant) => plant.id === id)) plants.delete(id);
    }
    target.plants = [...plants.values()];
  }
  return { version: 2, profiles: [...profiles.values()] };
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
  const snapshot = JSON.parse(decoder.decode(data));
  const validPlants = (plants) => Array.isArray(plants) && plants.every((plant) => plant?.id && plant?.name);
  if (Array.isArray(snapshot) && validPlants(snapshot)) return snapshot; // Sauvegardes de l'ancienne version.
  if (snapshot?.version === 2 && Array.isArray(snapshot.profiles) && snapshot.profiles.length &&
    snapshot.profiles.every((profile) => profile?.id && profile?.name && validPlants(profile.plants))) return snapshot;
  throw new Error('Données de profils invalides.');
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
async function synchronize() {
  if (!secret) { status('Crée ou colle une clé pour activer la synchronisation.'); return; }
  if (running) return running;
  running = (async () => {
    status('Synchronisation en cours…');
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const response = await request('GET', secret);
        const remoteEtag = response.status === 404 ? '' : response.headers.get('ETag');
        if (!dirty && response.status === 200 && remoteEtag !== etag) {
          const remote = await decrypt(await response.text(), secret);
          if (dirty) continue;
          applyPlants(remote);
          setEtag(remoteEtag);
          status('Plantes récupérées depuis le cloud.');
          return;
        }
        if (!dirty && response.status === 200) { status('Toutes tes plantes sont synchronisées.'); return; }
        if (!dirty) setDirty(true); // Premier envoi si le cloud est encore vide.

        const local = getPlants();
        const serial = editSerial;
        const changes = { profiles: [...pending.profiles], plants: [...pending.plants] };
        const remote = response.status === 200 && remoteEtag !== etag ? await decrypt(await response.text(), secret) : null;
        const merged = remote ? mergeGardens(remote, local, changes) : local;
        const saved = await request('PUT', secret, await encrypt(merged, secret), remoteEtag);
        if (saved.status === 409) continue; // Un autre appareil a écrit entre le GET et le PUT.
        setEtag(saved.headers.get('ETag'));
        if (editSerial === serial) {
          applyPlants(merged);
          setPending({ profiles: [], plants: [] });
          setDirty(false);
          status('Toutes tes plantes sont synchronisées.');
        } else {
          applyPlants(mergeGardens(merged, getPlants(), pending));
          setDirty(true);
          schedule();
        }
        return;
      }
      status('Le cloud change encore sur un autre appareil. Nouvelle tentative automatique dans quelques secondes.');
      schedule(3000);
    } catch (error) { status(`Synchronisation impossible : ${error.message}`); }
  })();
  try { await running; } finally {
    running = null;
    if (needsRerun) { needsRerun = false; schedule(rerunDelay); rerunDelay = 100; }
  }
}
function schedule(delay = 100) {
  if (running) { needsRerun = true; rerunDelay = Math.max(rerunDelay, delay); return; }
  clearTimeout(timer);
  timer = setTimeout(() => { void synchronize(); }, delay);
}

export function syncOnChange(changes = {}) {
  if (!secret) return;
  editSerial++;
  setPending({
    profiles: [...new Set([...pending.profiles, ...(changes.profiles || [])])],
    plants: [...new Set([...pending.plants, ...(changes.plants || [])])],
  });
  setDirty(true);
  status('Modifications en attente de synchronisation…');
  schedule();
}

export function initSync(handlers) {
  getPlants = handlers.getPlants;
  applyPlants = handlers.applyPlants;
  hasData = handlers.hasData;
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
        if (hasData() && JSON.stringify(getPlants()) !== JSON.stringify(remote) &&
          !confirm('Le cloud contient déjà des profils et des plantes. Remplacer les données présentes sur cet appareil par celles du cloud ? Cette action efface les changements locaux non synchronisés.')) {
          status('Connexion annulée. Les plantes locales sont conservées.'); return;
        }
        applyPlants(remote);
        secret = token;
        localStorage.setItem(KEY_STORAGE, token);
        setEtag(response.headers.get('ETag'));
        setPending({ profiles: [], plants: [] });
        setDirty(false);
        status('Connecté : plantes récupérées depuis le cloud. Copie la clé pour tes autres appareils.');
      } else {
        secret = token;
        localStorage.setItem(KEY_STORAGE, token);
        setEtag('');
        setPending({ profiles: [], plants: [] });
        setDirty(true);
        await synchronize();
        if (!dirty) status('Clé créée. Copie-la pour connecter tes autres appareils.');
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
    setEtag(''); setDirty(false); setPending({ profiles: [], plants: [] });
    $('#sync-key').value = '';
    status('Cet appareil est déconnecté. Ses plantes restent enregistrées localement.');
  });
  window.addEventListener('online', () => { void synchronize(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void synchronize(); });
  setInterval(() => { if (secret && !document.hidden && navigator.onLine) void synchronize(); }, 20000);
  if (secret) void synchronize();
}

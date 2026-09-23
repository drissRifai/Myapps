const KEY_STORAGE = 'mon-jardin-sync-key-v1';
const QUEUE_STORAGE = 'mon-jardin-sync-queue-v3';
const PREVIOUS_QUEUE_STORAGE = 'mon-jardin-sync-queue-v2';
const JOINED_STORAGE = 'mon-jardin-shared-joined-v1';
// Shared garden identifier, intentionally public: anyone with this site's URL can edit every profile.
const SHARED_KEY = 'WGNgNwW7sjM25COWHMmO_a-EQP3jeHhxOfZkid7C7vU';
const OLD_DIRTY_STORAGE = 'mon-jardin-sync-dirty-v1';
const OLD_PENDING_STORAGE = 'mon-jardin-sync-pending-v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const $ = (selector) => document.querySelector(selector);
const secret = SHARED_KEY;
let queue = readQueue();
let getGarden;
let applyGarden;
let running = null;
let timer;
let rerun = false;

function readQueue() {
  try {
    const items = JSON.parse(localStorage.getItem(QUEUE_STORAGE) || '[]');
    return Array.isArray(items) ? items.filter((item) => item?.id && ['profile', 'plant'].includes(item.kind)) : [];
  } catch { return []; }
}
function setQueue(items) {
  queue = items;
  if (queue.length) localStorage.setItem(QUEUE_STORAGE, JSON.stringify(queue));
  else localStorage.removeItem(QUEUE_STORAGE);
  $('#sync-open').textContent = queue.length ? `☁ En attente (${queue.length})` : '☁ Synchronisation';
}
function status(message, problem = false) {
  $('#sync-open').title = `${message} Cliquer pour réessayer.`;
  if (problem) $('#sync-open').textContent = '☁ À vérifier';
  else if (!queue.length) $('#sync-open').textContent = '☁ Synchronisé';
}
function base64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function fromBase64url(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
}
async function encryptionKey(token) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`mon-jardin:aes:${token}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encrypt(value, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(token), encoder.encode(JSON.stringify(value)));
  return JSON.stringify({ v: 1, iv: base64url(iv), data: base64url(new Uint8Array(data)) });
}
async function decrypt(payload, token) {
  const item = JSON.parse(payload);
  if (item?.v !== 1) throw new Error('Format de sauvegarde inconnu.');
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(item.iv) }, await encryptionKey(token), fromBase64url(item.data));
  return JSON.parse(decoder.decode(bytes));
}
function normalize(snapshot) {
  if (Array.isArray(snapshot)) return { version: 2, profiles: [{ id: 'principal', name: 'Principal', plants: snapshot }] };
  if (snapshot?.version === 2 && Array.isArray(snapshot.profiles)) return snapshot;
  return { version: 2, profiles: [] };
}
function applyOperation(garden, op) {
  if (op?.kind === 'profile' && op.profile?.id && op.profile?.name) {
    let profile = garden.profiles.find((item) => item.id === op.profile.id);
    if (profile) profile.name = op.profile.name;
    else garden.profiles.push({ id: op.profile.id, name: op.profile.name, plants: [] });
  } else if ((op?.kind === 'plant' || op?.kind === 'delete') && op.profileId) {
    let profile = garden.profiles.find((item) => item.id === op.profileId);
    if (!profile) { profile = { id: op.profileId, name: 'Principal', plants: [] }; garden.profiles.push(profile); }
    if (op.kind === 'plant' && op.plant?.id && op.plant?.name) {
      const index = profile.plants.findIndex((item) => item.id === op.plant.id);
      if (index < 0) profile.plants.push(op.plant);
      else profile.plants[index] = op.plant;
    } else if (op.kind === 'delete' && op.plantId) profile.plants = profile.plants.filter((item) => item.id !== op.plantId);
  }
}
function overlay(remote, local, markers) {
  const result = structuredClone(remote);
  for (const marker of markers) applyOperation(result, operationFor(marker, local));
  return result;
}
function operationFor(marker, garden) {
  const profile = garden.profiles.find((item) => item.id === marker.profileId);
  if (marker.kind === 'profile') return { kind: 'profile', profile: { id: marker.profileId, name: profile?.name || 'Principal' } };
  const plant = profile?.plants.find((item) => item.id === marker.plantId);
  return plant ? { kind: 'plant', profileId: marker.profileId, plant } : { kind: 'delete', profileId: marker.profileId, plantId: marker.plantId };
}
function addMarkers(changes) {
  const next = [...queue];
  for (const id of changes.profiles || []) {
    const key = `profile:${id}`;
    const index = next.findIndex((item) => item.key === key);
    if (index >= 0) next.splice(index, 1);
    next.push({ id: crypto.randomUUID(), key, kind: 'profile', profileId: id });
  }
  for (const key of changes.plants || []) {
    const index = next.findIndex((item) => item.key === key);
    if (index >= 0) next.splice(index, 1);
    const separator = key.indexOf(':');
    next.push({ id: crypto.randomUUID(), key, kind: 'plant', profileId: key.slice(0, separator), plantId: key.slice(separator + 1) });
  }
  setQueue(next);
}
function allMarkers(garden) {
  return { profiles: garden.profiles.map((profile) => profile.id), plants: garden.profiles.flatMap((profile) => profile.plants.map((plant) => `${profile.id}:${plant.id}`)) };
}
async function getJson(path, token) {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (response.status === 404 && path === '/api/sync') return null;
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error || `Erreur serveur (${response.status}).`);
  }
  return response.json();
}
async function loadRemote(token) {
  const legacy = await getJson('/api/sync', token);
  const garden = normalize(legacy ? await decrypt(JSON.stringify(legacy), token) : null);
  const entries = [];
  let cursor = null;
  for (let page = 0; page < 200; page++) {
    const path = `/api/ops${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
    const result = await getJson(path, token);
    if (!Array.isArray(result.operations)) throw new Error('Historique de synchronisation invalide.');
    entries.push(...result.operations);
    cursor = result.cursor;
    if (!cursor) break;
    if (page === 199) throw new Error('Historique trop volumineux.');
  }
  entries.sort((a, b) => a.uploaded.localeCompare(b.uploaded) || a.id.localeCompare(b.id));
  for (const entry of entries) applyOperation(garden, await decrypt(entry.payload, token));
  return garden;
}
function migrateOldPending(remote) {
  if (localStorage.getItem(OLD_DIRTY_STORAGE) !== '1') return;
  const local = getGarden();
  let old = {};
  try { old = JSON.parse(localStorage.getItem(OLD_PENDING_STORAGE) || '{}'); } catch { /* Ancienne file corrompue. */ }
  if (old.profiles?.length || old.plants?.length) addMarkers({ profiles: old.profiles, plants: old.plants });
  else {
    const copies = structuredClone(local);
    const changes = { profiles: [], plants: [] };
    for (const profile of copies.profiles) {
      const remoteProfile = remote.profiles.find((item) => item.id === profile.id);
      if (!remoteProfile || remoteProfile.name !== profile.name) changes.profiles.push(profile.id);
      for (const plant of profile.plants) {
        const other = remoteProfile?.plants.find((item) => item.id === plant.id);
        if (!other) changes.plants.push(`${profile.id}:${plant.id}`);
        else if (JSON.stringify(other) !== JSON.stringify(plant)) {
          plant.id = crypto.randomUUID();
          plant.name += ' (copie locale)';
          changes.plants.push(`${profile.id}:${plant.id}`);
        }
      }
    }
    applyGarden(copies);
    addMarkers(changes);
  }
  localStorage.removeItem(OLD_PENDING_STORAGE);
  localStorage.removeItem(OLD_DIRTY_STORAGE);
  localStorage.removeItem('mon-jardin-sync-etag-v1');
}
async function migrationId(source, kind, id) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${source}:${kind}:${id}`)));
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
async function sendOperation(id, operation, token) {
  const response = await fetch(`/api/ops/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: await encrypt(operation, token),
    cache: 'no-store',
  });
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error || `Envoi refusé (${response.status}).`);
  }
}
async function migratePreviousGarden(shared) {
  const previousKey = localStorage.getItem(KEY_STORAGE);
  if (!previousKey || previousKey === secret) {
    if (!localStorage.getItem(JOINED_STORAGE)) {
      const local = getGarden();
      const changes = { profiles: [], plants: [] };
      for (const profile of local.profiles) {
        const other = shared.profiles.find((item) => item.id === profile.id);
        if (!other && (profile.id !== 'principal' || profile.plants.length || profile.name !== 'Principal')) changes.profiles.push(profile.id);
        for (const plant of profile.plants) {
          if (!other?.plants.some((item) => item.id === plant.id)) changes.plants.push(`${profile.id}:${plant.id}`);
        }
      }
      if (changes.profiles.length || changes.plants.length) addMarkers(changes);
      localStorage.setItem(JOINED_STORAGE, '1');
    }
    return;
  }
  status('Reprise des plantes déjà enregistrées…');
  const previous = await loadRemote(previousKey);
  for (const profile of previous.profiles) {
    const existing = shared.profiles.find((item) => item.id === profile.id);
    if (!existing || (existing.name === 'Principal' && profile.name !== 'Principal')) {
      await sendOperation(await migrationId(previousKey, 'profile', profile.id), { kind: 'profile', profile: { id: profile.id, name: profile.name } }, secret);
    }
    for (const plant of profile.plants) {
      if (!existing?.plants.some((item) => item.id === plant.id)) {
        await sendOperation(await migrationId(previousKey, 'plant', `${profile.id}:${plant.id}`), { kind: 'plant', profileId: profile.id, plant }, secret);
      }
    }
  }
  migrateOldPending(previous);
  try {
    const oldQueue = JSON.parse(localStorage.getItem(PREVIOUS_QUEUE_STORAGE) || '[]');
    if (Array.isArray(oldQueue)) addMarkers({
      profiles: oldQueue.filter((item) => item.kind === 'profile').map((item) => item.profileId),
      plants: oldQueue.filter((item) => item.kind === 'plant').map((item) => item.key),
    });
  } catch { throw new Error('Anciennes modifications en attente illisibles.'); }
  localStorage.removeItem(PREVIOUS_QUEUE_STORAGE);
  localStorage.removeItem(KEY_STORAGE);
  localStorage.setItem(JOINED_STORAGE, '1');
}
async function sendMarker(marker, token) {
  await sendOperation(marker.id, operationFor(marker, getGarden()), token);
}
async function synchronize() {
  if (!secret) { status('Crée ou colle une clé pour activer la synchronisation.'); return; }
  if (running) { rerun = true; return running; }
  const token = secret;
  running = (async () => {
    status('Synchronisation en cours…');
    try {
      let remote = await loadRemote(token);
      if (token !== secret) return;
      await migratePreviousGarden(remote);
      remote = await loadRemote(token);
      applyGarden(queue.length ? overlay(remote, getGarden(), queue) : remote);
      let sent = 0;
      while (queue.length && sent < 100 && token === secret) {
        const marker = queue[0];
        await sendMarker(marker, token);
        if (queue[0]?.id === marker.id) setQueue(queue.slice(1));
        sent++;
      }
      if (token !== secret) return;
      const latest = await loadRemote(token);
      applyGarden(queue.length ? overlay(latest, getGarden(), queue) : latest);
      status(queue.length ? 'Envoi en cours…' : 'Tous les profils et plantes sont synchronisés.');
      if (queue.length) schedule();
    } catch (error) { status(`Synchronisation impossible : ${error.message}`, true); }
  })();
  try { await running; }
  finally { running = null; if (rerun) { rerun = false; schedule(); } }
}
function schedule(delay = 100) {
  if (running) { rerun = true; return; }
  clearTimeout(timer);
  timer = setTimeout(() => { void synchronize(); }, delay);
}
export function syncOnChange(changes = {}) {
  if (!secret) return;
  addMarkers(changes);
  status('Modifications en attente de synchronisation…');
  schedule();
}
export function initSync(handlers) {
  getGarden = handlers.getPlants;
  applyGarden = handlers.applyPlants;
  setQueue(queue);
  $('#sync-open').addEventListener('click', () => { void synchronize(); });
  window.addEventListener('online', () => { void synchronize(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void synchronize(); });
  setInterval(() => { if (secret && !document.hidden && navigator.onLine) void synchronize(); }, 20000);
  void synchronize();
}

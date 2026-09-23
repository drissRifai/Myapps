const STORAGE_KEY = 'mon-jardin-plants-v1';
const DAY = 86400000;
const $ = (selector) => document.querySelector(selector);
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = () => dateKey(new Date());
const parseDate = (key) => new Date(`${key}T12:00:00`);
const addDays = (key, days) => dateKey(new Date(parseDate(key).getTime() + days * DAY));
const daysBetween = (a, b) => Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / DAY);
const formatDate = (key, options = { day: 'numeric', month: 'long' }) => new Intl.DateTimeFormat('fr-FR', options).format(parseDate(key));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const uid = () => crypto.randomUUID();
// Intervalles de vérification indicatifs pour plantes d'intérieur, pas des consignes d'arrosage automatique.
const PLANT_PRESETS = {
  monstera: { species: 'Monstera deliciosa', summer: 7, winter: 14 },
  pothos: { species: 'Pothos', summer: 7, winter: 14 },
  spathiphyllum: { species: 'Spathiphyllum', summer: 5, winter: 10 },
  ficus: { species: 'Ficus elastica', summer: 7, winter: 14 },
  sansevieria: { species: 'Sansevieria', summer: 14, winter: 30 },
  aloe: { species: 'Aloe vera', summer: 14, winter: 30 },
  succulente: { species: 'Succulente', summer: 14, winter: 30 },
  cactus: { species: 'Cactus', summer: 21, winter: 45 },
};

function loadPlants() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data.filter((item) => item && item.id && item.name) : [];
  } catch { return []; }
}

let plants = loadPlants();
let view = ['accueil', 'plantes', 'calendrier'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'accueil';
let calendarOffset = 0;
let editingId = null;

function savePlants(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    plants = next;
    render();
    return true;
  } catch {
    $('#form-error').textContent = 'Stockage plein sur cet appareil. Essaie une photo plus légère ou supprime une plante.';
    return false;
  }
}

function seasonAt(key) {
  // Calendrier simplifié pour l'hémisphère nord ; chaque fréquence reste modifiable.
  const month = parseDate(key).getMonth() + 1;
  return month >= 4 && month <= 9 ? 'summer' : 'winter';
}

function wateringDue(plant) {
  let next = plant.lastWatered || today();
  for (let i = 0; i < 500; i++) {
    next = addDays(next, Number(plant[seasonAt(next)]) || 7);
    if (next > (plant.lastWatered || today())) return next;
  }
  return next;
}

function tasksFor(plant) {
  const tasks = [{ plant, kind: 'water', label: 'Arroser', icon: '💧', due: wateringDue(plant) }];
  if (plant.clean > 0) tasks.push({ plant, kind: 'clean', label: 'Nettoyer les feuilles', icon: '✦', due: addDays(plant.lastCleaned || plant.createdAt || today(), Number(plant.clean)) });
  return tasks;
}

function allTasks() { return plants.flatMap(tasksFor).sort((a, b) => a.due.localeCompare(b.due)); }
function dueText(key) {
  const delta = daysBetween(key, today());
  return delta < 0 ? `En retard de ${-delta} j` : delta === 0 ? "Aujourd’hui" : delta === 1 ? 'Demain' : `Dans ${delta} j`;
}
function googleCalendarUrl(task) {
  const [year, month, day] = task.due.split('-').map(Number);
  const end = dateKey(new Date(year, month - 1, day + 1)).replaceAll('-', '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${task.label} ${task.plant.name}`,
    dates: `${task.due.replaceAll('-', '')}/${end}`,
    details: task.kind === 'water' ? 'Rappel Mon Jardin : vérifie le terreau avant d’arroser.' : 'Rappel Mon Jardin : nettoyer les feuilles.',
  });
  return `https://calendar.google.com/calendar/r/eventedit?${params}`;
}
function taskMarkup(task, calendarLink = false) {
  const late = task.due <= today();
  return `<div class="task-row"><span class="task-icon ${task.kind}">${task.icon}</span><div class="task-copy"><strong>${escapeHtml(task.plant.name)}</strong><span>${task.label} · ${formatDate(task.due)}</span></div><span class="due ${late ? 'urgent' : ''}">${dueText(task.due)}</span>${calendarLink ? `<a class="calendar-link" href="${googleCalendarUrl(task)}" target="_blank" rel="noopener noreferrer" aria-label="Ajouter ${task.label.toLowerCase()} pour ${escapeHtml(task.plant.name)} à Google Calendar">Google Calendar ↗</a>` : ''}<button type="button" class="check-button" data-done="${task.plant.id}:${task.kind}" aria-label="Marquer ${task.label.toLowerCase()} pour ${escapeHtml(task.plant.name)} comme fait">✓</button></div>`;
}
function plantMarkup(plant) {
  const next = wateringDue(plant);
  const photo = plant.photo ? `<img src="${plant.photo}" alt="Photo de ${escapeHtml(plant.name)}" />` : `<span aria-hidden="true">🌿</span>`;
  const light = ({ indirecte: 'Lumière indirecte', directe: 'Soleil direct', faible: 'Lumière faible' })[plant.light] || 'Lumière indirecte';
  const nextClean = plant.clean > 0 ? addDays(plant.lastCleaned || plant.createdAt || today(), Number(plant.clean)) : null;
  return `<article class="plant-card"><div class="plant-photo">${photo}</div><div class="plant-tooltip" id="info-${plant.id}" role="tooltip"><strong>✳ Fiche rapide</strong><span>⌁ ${escapeHtml(plant.location || 'Emplacement non renseigné')}</span><span>☀ ${escapeHtml(light)}</span><span>💧 Vérifier le terreau : tous les ${Number(plant.summer) || 7} j en été · ${Number(plant.winter) || 14} j en hiver</span><span>Prochain arrosage à vérifier : ${formatDate(next)}</span>${nextClean ? `<span>Feuilles à nettoyer : ${formatDate(nextClean)}</span>` : ''}</div><div class="plant-body"><span class="plant-location">⌁ ${escapeHtml(plant.location || 'Sans emplacement')}</span><h3>${escapeHtml(plant.name)}</h3><p class="species">${escapeHtml(plant.species || 'Espèce non renseignée')}</p><div class="plant-divider"></div><div class="plant-meta"><span>☀ ${escapeHtml(light)}</span><span>💧 ${dueText(next)}</span></div><div class="plant-actions"><button type="button" class="info-button" data-info="${plant.id}" aria-expanded="false" aria-controls="info-${plant.id}">ⓘ Infos</button><button type="button" data-edit="${plant.id}">Modifier</button><button type="button" data-delete="${plant.id}" class="delete">Supprimer</button></div></div></article>`;
}

function emptyMarkup(message) { return `<div class="empty"><div class="empty-illustration">✳</div><h3>Ça va pousser ici.</h3><p>${message}</p><button class="button primary" data-add>Ajouter ma première plante <span>↗</span></button></div>`; }
function header(eyebrow, title, description, button = true) { return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${button ? '<button class="button primary" data-add>+ Ajouter une plante</button>' : ''}</div>`; }

function homeMarkup() {
  const tasks = allTasks();
  const due = tasks.filter((task) => task.due <= today());
  return `${header('TON JARDIN PERSONNEL', 'Bonjour, jardinier <em>✳</em>', 'Un petit coup d’œil à tes plantes et aux soins du moment.')}
    <div class="stats"><div class="stat"><span>MES PLANTES</span><strong>${plants.length.toString().padStart(2, '0')}</strong><small>petites vies à chouchouter</small></div><div class="stat highlight"><span>À FAIRE AUJOURD’HUI</span><strong>${due.length.toString().padStart(2, '0')}</strong><small>${due.length ? 'soins qui t’attendent' : 'tout est à jour, bravo !'}</small></div><div class="stat"><span>PROCHAIN SOIN</span><strong class="stat-date">${tasks.length ? formatDate(tasks[0].due, { day: 'numeric', month: 'short' }) : '—'}</strong><small>${tasks.length ? escapeHtml(tasks[0].plant.name) : 'ajoute une plante'}</small></div></div>
    <div class="section-title"><div><span class="eyebrow">À NE PAS OUBLIER</span><h2>Les soins à venir</h2></div><a href="#calendrier">Voir le calendrier ↗</a></div>
    <div class="task-list">${tasks.length ? tasks.slice(0, 6).map(taskMarkup).join('') : emptyMarkup('Ajoute ta première plante pour voir ses soins apparaître.')}</div>
    <div class="section-title second"><div><span class="eyebrow">LA PETITE JUNGLE</span><h2>Tes plantes</h2></div><a href="#plantes">Voir toutes les plantes ↗</a></div>
    ${plants.length ? `<div class="plant-grid">${plants.slice(0, 3).map(plantMarkup).join('')}</div>` : ''}`;
}

function plantsMarkup() { return `${header('LA PETITE JUNGLE', 'Mes plantes <em>✳</em>', 'Chaque plante a son histoire et son propre rythme.')}${plants.length ? `<div class="plant-grid">${plants.map(plantMarkup).join('')}</div>` : emptyMarkup('Le début d’une jolie collection, plante par plante.')}`; }

function calendarMarkup() {
  const month = new Date(new Date().getFullYear(), new Date().getMonth() + calendarOffset, 1);
  const year = month.getFullYear(), index = month.getMonth(), firstDay = (month.getDay() + 6) % 7;
  const count = new Date(year, index + 1, 0).getDate();
  const tasks = allTasks();
  const cells = Array.from({ length: firstDay }, () => '<div class="calendar-cell muted"></div>');
  for (let day = 1; day <= count; day++) {
    const key = dateKey(new Date(year, index, day));
    const dayTasks = tasks.filter((task) => task.due === key);
    cells.push(`<div class="calendar-cell ${key === today() ? 'current' : ''}"><span class="day-number">${day}</span>${dayTasks.map((task) => `<a class="calendar-event ${task.kind}" href="${googleCalendarUrl(task)}" target="_blank" rel="noopener noreferrer" title="Ajouter ${task.label.toLowerCase()} pour ${escapeHtml(task.plant.name)} à Google Calendar" aria-label="Ajouter ${task.label.toLowerCase()} pour ${escapeHtml(task.plant.name)} à Google Calendar">${task.icon} ${escapeHtml(task.plant.name)}</a>`).join('')}</div>`);
  }
  const overdue = tasks.filter((task) => task.due < today());
  return `${header('AU FIL DES JOURS', 'Le calendrier <em>✳</em>', 'Retrouve les prochains soins de tes plantes.')}
    ${overdue.length ? `<div class="overdue-note">${overdue.length} soin${overdue.length > 1 ? 's' : ''} en retard : retrouve-les ci-dessous et coche-les une fois faits.</div>` : ''}
    <div class="calendar-panel"><div class="calendar-head"><h2>${new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(month)}</h2><div><button data-month="-1" aria-label="Mois précédent">←</button><button data-month="0">Aujourd’hui</button><button data-month="1" aria-label="Mois suivant">→</button></div></div><div class="calendar-grid days">${['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day) => `<span>${day}</span>`).join('')}</div><div class="calendar-grid cells">${cells.join('')}</div></div>
    <div class="section-title second"><div><span class="eyebrow">TOUS LES SOINS</span><h2>À venir</h2></div></div><p class="calendar-help">Clique sur un soin pour préparer un événement dans Google Calendar, puis confirme son ajout là-bas. Les rappels ajoutés ne se mettent pas à jour automatiquement.</p><div class="task-list">${tasks.length ? tasks.map((task) => taskMarkup(task, true)).join('') : emptyMarkup('Ajoute une plante pour créer ton calendrier.')}</div>`;
}

function render() {
  $('#today-label').textContent = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  $('#breadcrumb').textContent = `MON ESPACE / ${{ accueil: 'VUE D’ENSEMBLE', plantes: 'MES PLANTES', calendrier: 'CALENDRIER' }[view]}`;
  document.querySelectorAll('.nav-link').forEach((link) => { link.classList.toggle('active', link.dataset.view === view); link.setAttribute('aria-current', link.dataset.view === view ? 'page' : 'false'); });
  $('#app').innerHTML = ({ accueil: homeMarkup, plantes: plantsMarkup, calendrier: calendarMarkup })[view]();
}

function openDialog(plant = null) {
  editingId = plant?.id || null;
  const form = $('#plant-form'); form.reset();
  $('#form-error').textContent = '';
  $('#photo-input').value = '';
  $('#dialog-title').textContent = plant ? 'Modifier la plante' : 'Ajouter une plante';
  form.elements.lastWatered.value = plant?.lastWatered || today();
  for (const field of ['name', 'species', 'location', 'light', 'summer', 'winter', 'clean']) if (plant?.[field] !== undefined) form.elements[field].value = plant[field];
  $('#plant-preset').value = Object.keys(PLANT_PRESETS).find((key) => PLANT_PRESETS[key].species === plant?.species) || '';
  $('#plant-dialog').showModal();
}

$('#plant-preset').addEventListener('change', (event) => {
  const preset = PLANT_PRESETS[event.target.value];
  if (!preset) return;
  const form = $('#plant-form');
  form.elements.species.value = preset.species;
  form.elements.summer.value = preset.summer;
  form.elements.winter.value = preset.winter;
});

async function shrinkPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choisis une image pour la photo.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Cette photo dépasse 15 Mo. Choisis une image plus légère.');
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
  return canvas.toDataURL('image/jpeg', 0.7);
}

$('#plant-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const old = plants.find((plant) => plant.id === editingId);
  const values = Object.fromEntries(new FormData(form));
  const plant = { ...old, id: old?.id || uid(), createdAt: old?.createdAt || today(), name: values.name.trim(), species: values.species.trim(), location: values.location.trim(), light: values.light, summer: Number(values.summer), winter: Number(values.winter), clean: Number(values.clean), lastWatered: values.lastWatered, lastCleaned: old?.lastCleaned || today(), photo: old?.photo || '' };
  if (!plant.name) { $('#form-error').textContent = 'Donne un nom à ta plante.'; return; }
  for (const field of ['summer', 'winter', 'clean']) if (!Number.isInteger(plant[field]) || plant[field] < 1 || plant[field] > 365) { $('#form-error').textContent = 'Les fréquences doivent être comprises entre 1 et 365 jours.'; return; }
  try {
    const file = $('#photo-input').files[0]; if (file) plant.photo = await shrinkPhoto(file);
    if (savePlants(old ? plants.map((item) => item.id === old.id ? plant : item) : [...plants, plant])) $('#plant-dialog').close();
  } catch (error) { $('#form-error').textContent = error.message || 'Impossible de lire cette photo.'; }
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('button'); if (!target) return;
  if (target.matches('[data-add]')) openDialog();
  if (target.dataset.info) {
    const card = target.closest('.plant-card');
    const open = card.classList.toggle('info-open');
    target.setAttribute('aria-expanded', String(open));
  }
  if (target.dataset.edit) openDialog(plants.find((plant) => plant.id === target.dataset.edit));
  if (target.dataset.delete) {
    const plant = plants.find((item) => item.id === target.dataset.delete);
    if (plant && confirm(`Supprimer ${plant.name} et son historique ?`)) savePlants(plants.filter((item) => item.id !== plant.id));
  }
  if (target.dataset.done) {
    const [id, kind] = target.dataset.done.split(':');
    savePlants(plants.map((plant) => plant.id === id ? { ...plant, [kind === 'water' ? 'lastWatered' : 'lastCleaned']: today() } : plant));
  }
  if (target.dataset.month) { calendarOffset = target.dataset.month === '0' ? 0 : calendarOffset + Number(target.dataset.month); render(); }
});

$('#close-dialog').addEventListener('click', () => $('#plant-dialog').close());
$('#cancel-dialog').addEventListener('click', () => $('#plant-dialog').close());
$('#plant-dialog').addEventListener('click', (event) => { if (event.target === $('#plant-dialog')) $('#plant-dialog').close(); });
window.addEventListener('hashchange', () => { view = ['accueil', 'plantes', 'calendrier'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'accueil'; render(); });
render();

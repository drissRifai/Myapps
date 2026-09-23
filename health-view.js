const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const symptoms = {
  jaunes: { label:'Feuilles jaunes', advice:'Regarde si le terreau reste humide longtemps et si le pot peut s’égoutter. Le jaunissement peut aussi venir d’un changement de lumière.' },
  brunes: { label:'Pointes brunes', advice:'Vérifie l’air sec, la proximité d’un radiateur et la régularité des arrosages.' },
  molles: { label:'Feuilles molles', advice:'Touche la terre en profondeur avant d’arroser : une plante trop arrosée peut aussi sembler flétrie.' },
  taches: { label:'Taches sur les feuilles', advice:'Observe les deux faces des feuilles, l’évolution des taches et l’exposition au soleil.' },
  parasites: { label:'Petites bêtes', advice:'Isole la plante des autres et inspecte le dessous des feuilles avant tout traitement.' },
  croissance: { label:'Ne pousse plus', advice:'Compare la lumière et la saison ; beaucoup de plantes poussent moins vite en hiver.' },
};
let getPlants;
let selected = '';
let selectedSymptoms = new Set();
let image = '';
let messages = [];
let pending = false;
let notice = '';
let draft = '';
let otherName = '';
let useExistingPhoto = false;
let accessCode = sessionStorage.getItem('mon-jardin-health-code') || '';
let codeDraft = '';
const $ = (selector) => document.querySelector(selector);

function currentPlant() { return getPlants().find((plant) => plant.id === selected); }
function redraw() { if ($('#health-root')) $('#health-root').outerHTML = renderHealth(); }
export function renderHealth() {
  const plants = getPlants();
  if (selected && !plants.some((plant) => plant.id === selected)) { selected = ''; messages = []; image = ''; }
  const plant = currentPlant();
  const advice = [...selectedSymptoms].map((id) => symptoms[id].advice);
  return `<section id="health-root" class="health-page"><div class="page-heading"><div><span class="eyebrow">PRENONS LE TEMPS D’OBSERVER</span><h1>Ma plante va mal <em>✳</em></h1><p>Quelques questions pour comprendre ce qui se passe, puis une analyse de la photo si tu le souhaites.</p></div></div>
    <div class="health-layout"><div class="health-panel"><h2>Que remarques-tu ?</h2>
    <label class="field">Plante concernée<select id="health-plant"><option value="">Autre plante / sans fiche</option>${plants.map((item) => `<option value="${escapeHtml(item.id)}" ${selected === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
    ${!plant ? `<label class="field">Nom de la plante<input id="health-name" value="${escapeHtml(otherName)}" placeholder="Ex. : mon pothos" maxlength="80"></label>` : `<p class="health-context">${escapeHtml(plant.species || 'Espèce inconnue')} · ${escapeHtml(plant.location || 'Emplacement inconnu')}</p>`}
    <fieldset class="health-symptoms"><legend>Symptômes visibles</legend>${Object.entries(symptoms).map(([id, item]) => `<label class="health-chip ${selectedSymptoms.has(id) ? 'selected' : ''}"><input type="checkbox" data-health-symptom="${id}" ${selectedSymptoms.has(id) ? 'checked' : ''}>${item.label}</label>`).join('')}</fieldset>
    ${advice.length ? `<div class="health-first-steps"><strong>À vérifier d’abord</strong><ul>${advice.map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}</ul></div>` : '<p class="health-hint">Choisis un symptôme pour voir les premières vérifications utiles.</p>'}
    <form id="health-form"><label class="field">Décris ce qui se passe<textarea id="health-question" maxlength="1500" rows="4" required placeholder="Depuis quand ? Le terreau est-il sec ou humide sous la surface ? Quelle lumière reçoit-elle ?">${escapeHtml(draft)}</textarea></label>
    <label class="field">Photo à analyser (facultative)<input id="health-photo" type="file" accept="image/jpeg,image/png,image/webp" /><small>La photo est envoyée à l’API OpenAI uniquement quand tu demandes l’analyse.</small></label>
    ${image ? `<div class="health-preview"><img src="${image}" alt="Photo choisie pour l’analyse" /><button type="button" data-health-remove-photo>Retirer la photo</button></div>` : ''}
    ${plant?.photo && !image ? `<label class="health-existing"><input type="checkbox" id="health-existing" ${useExistingPhoto ? 'checked' : ''}> Utiliser la photo déjà enregistrée de cette plante</label>` : ''}
    ${!accessCode ? '<label class="field">Code d’accès à l’analyse IA<input id="health-code" type="password" autocomplete="off" value="${escapeHtml(codeDraft)}" placeholder="Code défini dans Cloudflare" required /><small>Il protège ton crédit API ; il reste sur cet appareil le temps de la session.</small></label>' : ''}
    <button class="button primary" type="submit" ${pending ? 'disabled' : ''}>${pending ? 'Analyse en cours…' : messages.length ? 'Envoyer ma réponse ↗' : 'Analyser ma plante ↗'}</button><p id="health-notice" class="health-notice" role="status">${escapeHtml(notice)}</p></form></div>
    <div class="health-panel health-conversation"><div class="health-chat-heading"><h2>Échange & conseils</h2>${messages.length ? '<button type="button" data-health-reset>Nouvelle analyse</button>' : ''}</div><p class="health-hint">L’analyse peut se tromper, surtout si la photo ne montre pas les racines ou le terreau. Vérifie avant d’agir.</p>
    ${messages.length ? `<div class="health-messages">${messages.map((message) => `<div class="health-message ${message.role}"><strong>${message.role === 'assistant' ? 'Conseil IA' : 'Toi'}</strong><p>${escapeHtml(message.text)}</p></div>`).join('')}</div>` : '<div class="health-placeholder">🌿<p>Raconte-moi ce qui arrive à ta plante. Je t’aiderai à trouver quoi regarder en premier.</p></div>'}
    </div></div></section>`;
}

async function prepareImage(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choisis une photo JPEG, PNG ou WebP.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Photo trop volumineuse (12 Mo maximum).');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL('image/jpeg', .72);
    if (encoded.length > 1_500_000) throw new Error('Photo trop volumineuse après réduction.');
    return encoded;
  } finally { bitmap.close(); }
}

export function initHealth(handlers) {
  getPlants = handlers.getPlants;
  document.addEventListener('change', async (event) => {
    if (event.target.id === 'health-plant') { selected = event.target.value; messages = []; image = ''; useExistingPhoto = false; notice = ''; redraw(); }
    if (event.target.id === 'health-existing') useExistingPhoto = event.target.checked;
    if (event.target.dataset.healthSymptom) {
      const id = event.target.dataset.healthSymptom;
      if (event.target.checked) selectedSymptoms.add(id); else selectedSymptoms.delete(id);
      draft = $('#health-question')?.value || '';
      redraw();
    }
    if (event.target.id === 'health-photo' && event.target.files[0]) {
      try { image = await prepareImage(event.target.files[0]); notice = ''; } catch (error) { notice = error.message; }
      draft = $('#health-question')?.value || ''; redraw();
    }
  });
  document.addEventListener('input', (event) => {
    if (event.target.id === 'health-question') draft = event.target.value;
    if (event.target.id === 'health-name') otherName = event.target.value;
    if (event.target.id === 'health-code') codeDraft = event.target.value;
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-health-remove-photo]')) { image = ''; redraw(); }
    if (event.target.closest('[data-health-reset]')) { messages = []; selectedSymptoms.clear(); image = ''; useExistingPhoto = false; draft = ''; notice = ''; redraw(); }
  });
  document.addEventListener('submit', async (event) => {
    if (event.target.id !== 'health-form') return;
    event.preventDefault();
    if (pending) return;
    const question = $('#health-question').value.trim();
    if (!question) return;
    const candidateCode = accessCode || codeDraft.trim() || '';
    if (!candidateCode) return;
    const photo = image || (useExistingPhoto ? currentPlant()?.photo : '') || '';
    const plant = currentPlant() || { name: otherName || 'Plante non identifiée' };
    const context = { name: plant.name, species: plant.species, location: plant.location, light: plant.light, lastWatered: plant.lastWatered };
    const prompt = `${[...selectedSymptoms].map((id) => symptoms[id].label).join(', ')}. ${question}`;
    pending = true; notice = ''; redraw();
    try {
      const response = await fetch('/api/health', { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Health-Code':candidateCode }, body:JSON.stringify({ question:prompt, plant:context, image:photo, history:messages.slice(-8) }), cache:'no-store' });
      const result = await response.json();
      if (!response.ok) { if (response.status === 401) { accessCode = ''; codeDraft = ''; sessionStorage.removeItem('mon-jardin-health-code'); } throw new Error(result.error || 'Analyse indisponible.'); }
      accessCode = candidateCode; sessionStorage.setItem('mon-jardin-health-code', accessCode);
      messages.push({ role:'user', text:question }, { role:'assistant', text:result.answer });
      draft = ''; notice = '';
    } catch (error) { notice = error.message || 'Connexion impossible. Réessaie.'; }
    finally { pending = false; redraw(); }
  });
}

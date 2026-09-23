const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
const reply = (message, status) => new Response(JSON.stringify({ error: message }), { status, headers });
const MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/;
const INSTRUCTIONS = `Tu es un assistant de soins des plantes d'intérieur. Réponds en français, avec tact et concision. Analyse les symptômes décrits et, si fournie, l'image. Ne présente jamais un diagnostic visuel comme certain ; une photo peut cacher l'état des racines et du terreau. Donne 1 à 3 hypothèses plausibles, les signes à vérifier, et des gestes prudents et concrets. Demande au maximum deux informations importantes quand elles manquent (humidité du terreau en profondeur, lumière, drainage, température, fréquence réelle). N'affirme pas qu'une plante doit être arrosée sur la base d'un calendrier. Ne conseille pas de pesticide sans identification fiable. Pour une plante gravement abîmée, privilégie l'observation et les actions réversibles. Ne traite que l'entretien des plantes.`;

async function sameCode(given, expected) {
  if (!given || !expected || given.length > 256 || expected.length < 16) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(given)), crypto.subtle.digest('SHA-256', encoder.encode(expected))]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left[i] ^ right[i];
  return different === 0;
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply('Méthode non autorisée.', 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return reply('Origine refusée.', 403);
  if (!env.OPENAI_API_KEY || !env.HEALTH_ACCESS_CODE) return reply('Analyse IA indisponible : configuration Cloudflare à terminer.', 503);
  if (!(await sameCode(request.headers.get('X-Health-Code'), env.HEALTH_ACCESS_CODE))) return reply('Code d’accès incorrect.', 401);
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return reply('Photo trop volumineuse.', 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return reply('Photo trop volumineuse.', 413);
  let data;
  try { data = JSON.parse(raw); } catch { return reply('Demande invalide.', 400); }
  const question = typeof data.question === 'string' ? data.question.trim() : '';
  if (!question || question.length > 1500) return reply('Décris les symptômes en 1 500 caractères maximum.', 400);
  const image = data.image;
  if (image && (typeof image !== 'string' || image.length > 1_500_000 || !IMAGE_PATTERN.test(image))) return reply('Photo invalide ou trop volumineuse.', 400);
  const plant = data.plant && typeof data.plant === 'object' ? data.plant : {};
  const context = ['name', 'species', 'location', 'light', 'lastWatered'].map((key) => `${key}: ${String(plant[key] ?? '').slice(0, 100)}`).join('; ');
  const history = Array.isArray(data.history) ? data.history.slice(-8).filter((item) =>
    (item?.role === 'user' || item?.role === 'assistant') && typeof item.text === 'string' && item.text.length <= 2000) : [];
  const input = history.map((item) => ({ role: item.role, content: item.text }));
  const content = [{ type: 'input_text', text: `Plante : ${context}\nSymptômes et question : ${question}` }];
  if (image) content.push({ type: 'input_image', image_url: image, detail: 'low' });
  input.push({ role: 'user', content });
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4.1-mini', instructions: INSTRUCTIONS, input, max_output_tokens: 650, store: false }),
    });
  } catch { return reply('Connexion à l’analyse IA impossible. Réessaie dans un instant.', 502); }
  if (!response.ok) {
    if (response.status === 429) return reply('Limite de l’API atteinte. Réessaie plus tard.', 429);
    if (response.status === 401 || response.status === 403) return reply('Clé API OpenAI invalide ou sans accès à ce modèle.', 503);
    return reply(`Analyse IA indisponible (${response.status}).`, 502);
  }
  let result;
  try { result = await response.json(); } catch { return reply('Réponse IA illisible.', 502); }
  const answer = (result.output || []).flatMap((item) => item.content || []).filter((part) => part.type === 'output_text').map((part) => part.text).join('\n').trim();
  if (!answer) return reply('L’analyse n’a pas renvoyé de texte. Réessaie.', 502);
  return new Response(JSON.stringify({ answer }), { headers });
}

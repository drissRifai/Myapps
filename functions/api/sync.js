const MAX_BYTES = 8 * 1024 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' };

function reply(message, status, extra = {}) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...headers, ...extra } });
}

async function keyFor(request) {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!TOKEN_PATTERN.test(token)) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mon-jardin:r2:${token}`));
  return `gardens/${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}.json`;
}

export async function onRequest({ request, env }) {
  if (!env.GARDEN_BUCKET) return reply('Le bucket R2 GARDEN_BUCKET n’est pas encore lié à ce site.', 503);
  const key = await keyFor(request);
  if (!key) return reply('Clé de synchronisation invalide.', 401);

  if (request.method === 'GET') {
    const object = await env.GARDEN_BUCKET.get(key);
    if (!object) return reply('Aucune sauvegarde pour cette clé.', 404);
    return new Response(object.body, { headers: { ...headers, ETag: object.httpEtag } });
  }

  if (request.method === 'PUT') {
    const length = Number(request.headers.get('Content-Length'));
    if (length > MAX_BYTES) return reply('Sauvegarde trop volumineuse (8 Mo maximum).', 413);
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return reply('Sauvegarde trop volumineuse (8 Mo maximum).', 413);
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { return reply('Sauvegarde invalide.', 400); }
    if (payload?.v !== 1 || typeof payload.iv !== 'string' || typeof payload.data !== 'string') return reply('Sauvegarde invalide.', 400);

    const previous = request.headers.get('If-Match');
    const creating = request.headers.get('If-None-Match') === '*';
    if (!creating && !/^"[a-f0-9]+"$/.test(previous || '')) return reply('Version de sauvegarde manquante.', 428);
    const onlyIf = creating ? new Headers({ 'If-None-Match': '*' }) : new Headers({ 'If-Match': previous });
    const object = await env.GARDEN_BUCKET.put(key, body, { onlyIf, httpMetadata: { contentType: 'application/json' } });
    if (!object) return reply('La sauvegarde a changé sur un autre appareil. Rien n’a été écrasé.', 409);
    return new Response(JSON.stringify({ ok: true }), { headers: { ...headers, ETag: object.httpEtag } });
  }
  return reply('Méthode non autorisée.', 405, { Allow: 'GET, PUT' });
}

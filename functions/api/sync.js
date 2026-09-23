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

  if (request.method === 'PUT') return reply('Ancienne synchronisation désactivée. Recharge la page pour utiliser la nouvelle version.', 410);
  return reply('Méthode non autorisée.', 405, { Allow: 'GET' });
}

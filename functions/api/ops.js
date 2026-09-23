const MAX_BYTES = 4 * 1024 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' };
const error = (message, status) => new Response(JSON.stringify({ error: message }), { status, headers });

async function prefixFor(request) {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!TOKEN_PATTERN.test(token)) return null;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mon-jardin:r2:${token}`));
  const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `ops/${hex}/`;
}

export async function onRequest({ request, env }) {
  if (!env.GARDEN_BUCKET) return error('Le bucket R2 n’est pas lié au Worker.', 503);
  const prefix = await prefixFor(request);
  if (!prefix) return error('Clé de synchronisation invalide.', 401);
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/api/ops') {
    const cursor = url.searchParams.get('cursor') || undefined;
    if (cursor && cursor.length > 2048) return error('Curseur invalide.', 400);
    let page;
    try { page = await env.GARDEN_BUCKET.list({ prefix, limit: 20, cursor }); }
    catch { return error('Impossible de lister les modifications.', 500); }
    const operations = await Promise.all(page.objects.map(async (entry) => {
      const object = await env.GARDEN_BUCKET.get(entry.key);
      if (!object) return null; // Une suppression concurrente ne doit pas faire échouer la page entière.
      return { id: entry.key.slice(prefix.length, -5), uploaded: entry.uploaded.toISOString(), payload: await object.text() };
    }));
    return new Response(JSON.stringify({ operations: operations.filter(Boolean), cursor: page.truncated ? page.cursor : null }), { headers });
  }

  if (request.method === 'PUT' && url.pathname.startsWith('/api/ops/')) {
    const id = url.pathname.slice('/api/ops/'.length);
    if (!ID_PATTERN.test(id)) return error('Identifiant de modification invalide.', 400);
    if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return error('Modification trop volumineuse.', 413);
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return error('Modification trop volumineuse.', 413);
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(body)); }
    catch { return error('Modification invalide.', 400); }
    if (payload?.v !== 1 || typeof payload.iv !== 'string' || typeof payload.data !== 'string') return error('Modification invalide.', 400);
    const key = `${prefix}${id}.json`;
    const stored = await env.GARDEN_BUCKET.put(key, body, {
      onlyIf: new Headers({ 'If-None-Match': '*' }),
      httpMetadata: { contentType: 'application/json' },
    });
    // Réessayer le même identifiant après une réponse réseau perdue est sans effet secondaire.
    return new Response(JSON.stringify({ ok: true, alreadyStored: !stored }), { headers });
  }
  return error('Route non trouvée.', 404);
}

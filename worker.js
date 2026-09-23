import { onRequest as syncRequest } from './functions/api/sync.js';
import { onRequest as opsRequest } from './functions/api/ops.js';

export default {
  async fetch(request, env, context) {
    const path = new URL(request.url).pathname;
    if (path === '/api/sync') return syncRequest({ request, env, context });
    if (path === '/api/ops' || path.startsWith('/api/ops/')) return opsRequest({ request, env, context });
    return env.ASSETS.fetch(request);
  },
};

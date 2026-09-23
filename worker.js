import { onRequest as syncRequest } from './functions/api/sync.js';
import { onRequest as opsRequest } from './functions/api/ops.js';
import { onRequest as healthRequest } from './functions/api/health.js';

export default {
  async fetch(request, env, context) {
    const path = new URL(request.url).pathname;
    if (path === '/api/sync') return syncRequest({ request, env, context });
    if (path === '/api/ops' || path.startsWith('/api/ops/')) return opsRequest({ request, env, context });
    if (path === '/api/health') return healthRequest({ request, env, context });
    return env.ASSETS.fetch(request);
  },
};

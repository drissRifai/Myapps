import { onRequest as syncRequest } from './functions/api/sync.js';

export default {
  async fetch(request, env, context) {
    const path = new URL(request.url).pathname;
    if (path === '/api/sync') return syncRequest({ request, env, context });
    return env.ASSETS.fetch(request);
  },
};

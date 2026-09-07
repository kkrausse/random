import { resolve } from 'node:path';
const root = import.meta.dirname;
const port = Number(process.env.PORT ?? 5216);
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' };
if (!await Bun.file(resolve(root, '.snapshot/manifest.json')).exists()) throw Error('Run bun build.ts first');
Bun.serve({ hostname: '127.0.0.1', port, async fetch(req) {
   const path = new URL(req.url).pathname;
   if (path === '/api/catalog/api.json') {
     if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers });
     try {
       const upstream = await fetch('https://models.opencode.ai/api.json', { signal: AbortSignal.any([req.signal, AbortSignal.timeout(10000)]) });
       return new Response(upstream.body, { status: upstream.status, headers: { ...headers, 'Content-Type': 'application/json' } });
     } catch {
       return new Response('Catalog upstream unavailable', { status: 502, headers });
     }
   }
  const relative = path === '/' ? '../index.html' : path === '/sw.js' ? 'runtime/assets/sw.js' : path.startsWith('/assets/') ? 'runtime' + path : path;
  const file = Bun.file(resolve(root, '.snapshot', '.' + (relative.startsWith('/') ? relative : '/' + relative)));
  return new Response(await file.exists() ? file : 'Missing asset; run bun build.ts', { status: await file.exists() ? 200 : 404, headers });
} });
console.log(`Open http://127.0.0.1:${port}/ — keep this host terminal running`);

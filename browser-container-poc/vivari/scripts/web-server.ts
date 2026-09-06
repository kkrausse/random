import { resolve, sep } from 'node:path';
import { modelProxy } from './model-proxy';
import { enabledProviders } from '../src/model-transport';
import catalog from '../src/provider-upstreams.json';

const proxy = modelProxy(new Map(enabledProviders.map(id => [id, {
  baseURL: catalog.upstreams[id],
  // Explicit app-specific opt-in; never discover host OpenCode credentials.
  headers: { authorization: `Bearer ${process.env.VIVARI_MODEL_API_KEY || 'public'}` },
}])));
const dist = resolve(import.meta.dir, '../dist');
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};
const server = Bun.serve({
  hostname: '127.0.0.1', port: Number(process.env.VIVARI_WEB_PORT || 5194), idleTimeout: 240,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/model/')) return proxy(request);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    let path: string;
    try { path = resolve(dist, '.' + decodeURIComponent(url.pathname)); }
    catch { return new Response('Invalid path', { status: 400 }); }
    if (path !== dist && !path.startsWith(dist + sep)) return new Response('Invalid path', { status: 400 });
    const file = Bun.file(path === dist ? resolve(dist, 'index.html') : path);
    if (!await file.exists()) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : file, { headers: { ...isolation, 'Content-Type': file.type } });
  },
});
console.log(`Web app / model proxy: ${server.url}`);

// Isolated static origin; baseline build and pinned VM assets are read-only.
import { resolve, sep } from 'node:path';
const baseline = resolve(import.meta.dir, '../qemu');
const server = Bun.serve({
  hostname: '127.0.0.1', port: Number(process.env.PORT ?? 5198),
  async fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    const root = path.startsWith('/qemu/') ? resolve(baseline, 'public') : resolve(baseline, 'dist');
    const target = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!target.startsWith(root + sep)) return new Response('Forbidden', { status: 403 });
    const file = Bun.file(target);
    return new Response(await file.exists() ? file : 'Not found', {
      status: await file.exists() ? 200 : 404,
      headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-cache' },
    });
  },
});
console.log(server.url.href);

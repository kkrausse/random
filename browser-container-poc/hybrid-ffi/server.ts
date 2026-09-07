import { resolve } from 'node:path';
const root = resolve(import.meta.dir, '../hybrid');
const routes = new Map<string, string>([
  ['/', 'index.html'], ['/runtime.html', 'runtime.html'], ['/main.js', 'dist/main.js'],
  ['/runtime.js', 'dist/runtime.js'], ['/runtime.css', 'dist/runtime.css'],
  ['/sw.js', '.artifacts/fixed-runtime/assets/sw.js'],
  ['/serial-bridge.js', '.artifacts/references/serial-bridge.js'],
  ['/guest-bridge.ts', '.artifacts/references/preview-bridge.ts'],
]);
const lock = await Bun.file(resolve(root, 'artifacts.lock.json')).json();
for (const e of lock.entries) {
  if (e.target.startsWith('qemu/')) routes.set('/' + e.target, e.source);
  else if (e.target.startsWith('vivari/assets/')) routes.set('/' + e.target.slice(7), '.artifacts/' + e.target);
  else if (e.target.startsWith('vendor/')) routes.set('/' + e.target, '.artifacts/' + e.target);
}
for (const e of (await Bun.file(resolve(root, 'runtime-build.json')).json()).files)
  if (e.name.startsWith('assets/')) routes.set('/' + e.name, '.artifacts/fixed-runtime/' + e.name);
const fixture = Object.fromEntries(await Promise.all(lock.entries.filter((e: any) => e.target.startsWith('fixture/')).map(async (e: any) =>
  [e.target.slice(8), await Bun.file(resolve(root, '.artifacts', e.target)).text()])));
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-cache' };
Bun.serve({ hostname: '127.0.0.1', port: 5222, fetch(req) {
  if (req.method !== 'GET') return new Response('Static only', { status: 405, headers });
  const path = new URL(req.url).pathname;
  if (path === '/fixture.json') return Response.json(fixture, { headers });
  if (['/guest.ts', '/client.cjs'].includes(path)) return new Response(Bun.file(resolve(import.meta.dir, path.slice(1))), { headers });
  const file = routes.get(path);
  return new Response(file ? Bun.file(resolve(root, file)) : 'Not found', { status: file ? 200 : 404, headers });
} });
console.log('Read-only reused harness: http://127.0.0.1:5222');

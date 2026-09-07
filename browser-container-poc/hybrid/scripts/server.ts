await import('./artifacts');
await import('./build');
import { resolve } from 'node:path';
const root = resolve(import.meta.dir, '..');
const lock = await Bun.file(resolve(root, 'artifacts.lock.json')).json();
const routes = new Map<string, string>([
  ['/', 'index.html'], ['/runtime.html', 'runtime.html'],
  ['/main.js', 'dist/main.js'], ['/runtime.js', 'dist/runtime.js'], ['/runtime.css', 'dist/runtime.css'],
  ['/sw.js', '.artifacts/fixed-runtime/assets/sw.js'],
  ['/serial-bridge.js', '.artifacts/references/serial-bridge.js'],
  ['/guest-bridge.ts', '.artifacts/references/preview-bridge.ts'],
  ['/deps-manifest.json', 'deps-manifest.json'], ['/vendor/hybrid-deps.bin', '.artifacts/deps/hybrid-deps.bin'],
  ['/worker-package-lock.json', 'worker-package-lock.json'],
]);
for (const entry of lock.entries) {
  const path = entry.target as string;
  if (path.startsWith('qemu/')) routes.set('/' + path, entry.source);
  else if (path.startsWith('vivari/assets/')) routes.set('/' + path.slice(7), '.artifacts/' + path);
  else if (path.startsWith('vendor/') || path.startsWith('fixture/')) routes.set('/' + path, '.artifacts/' + path);
}
const runtime = await Bun.file(resolve(root, 'runtime-build.json')).json();
for (const entry of runtime.files) {
  const file = Bun.file(resolve(root, '.artifacts/fixed-runtime', entry.name));
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error(`Hybrid runtime mismatch: ${entry.name}`);
  if (entry.name.startsWith('assets/')) routes.set('/' + entry.name, '.artifacts/fixed-runtime/' + entry.name);
}
const fixture = Object.fromEntries(await Promise.all(lock.entries.filter((e: any) => e.target.startsWith('fixture/')).map(async (e: any) =>
  [e.target.slice(8), await Bun.file(resolve(root, '.artifacts', e.target)).text()])));
const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache' };
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT || 5213), fetch(req) {
  if (!['GET', 'HEAD'].includes(req.method)) return new Response('Static harness only', { status: 405, headers });
  const path = new URL(req.url).pathname;
  if (path === '/fixture.json') return Response.json(fixture, { headers });
  const file = routes.get(path);
  return file ? new Response(Bun.file(resolve(root, file)), { headers }) : new Response('Not found', { status: 404, headers });
} });
console.log(`Hybrid static harness: ${server.url}`);

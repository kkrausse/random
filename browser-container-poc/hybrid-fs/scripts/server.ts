import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'..'),hybrid=resolve(root,'../hybrid');
const routes=new Map([['/',resolve(root,'index.html')],['/main.js',resolve(root,'dist/main.js')],['/guest.js',resolve(root,'.artifacts/guest.js')],['/runtime.html',resolve(hybrid,'runtime.html')],['/runtime.js',resolve(hybrid,'dist/runtime.js')],['/runtime.css',resolve(hybrid,'dist/runtime.css')],['/serial-bridge.js',resolve(root,'../qemu/public/serial-bridge.js')],['/sw.js',resolve(root,'.artifacts/runtime/assets/sw.js')],['/vendor/npm-pack.bin',resolve(root,'../vivari/public/vendor/npm-pack.bin')]]);
for await(const p of new Bun.Glob('assets/*').scan({cwd:resolve(root,'.artifacts/runtime')}))routes.set('/'+p,resolve(root,'.artifacts/runtime',p));
for await(const p of new Bun.Glob('**/*').scan({cwd:resolve(root,'../qemu/public/qemu'),onlyFiles:true}))routes.set('/qemu/'+p,resolve(root,'../qemu/public/qemu',p));
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Service-Worker-Allowed':'/','Cache-Control':'no-cache'};
routes.set('/vendor/hybrid-deps.bin',resolve(hybrid,'.artifacts/deps/hybrid-deps.bin'));
routes.set('/deps-manifest.json',resolve(hybrid,'deps-manifest.json'));
console.log(Bun.serve({hostname:'127.0.0.1',port:5220,fetch(req){if(!['GET','HEAD'].includes(req.method))return new Response('Static only',{status:405,headers});const name=new URL(req.url).pathname;const p=/^\/assets\/[\w.-]+$/.test(name)?resolve(root,'.artifacts/runtime',name.slice(1)):routes.get(name);return p?new Response(Bun.file(p),{headers}):new Response('Not found',{status:404,headers});}}).url.toString());

import {resolve} from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
import {patchWait} from '../../hybrid/scripts/syscall-wait';
import {patchPoll} from './poll-watch';
const root=resolve(import.meta.dir,'..'), up=resolve(root,'../vivari/.runtime/baseline'), out=resolve(root,'.artifacts/runtime');
const revision=(await Bun.$`git -C ${up} rev-parse HEAD`.text()).trim();
if(revision!=='2629c71097238400c45aefa213ef61df4794c2b7')throw Error('Unexpected baseline revision');
await Bun.$`git -C ${up} diff --quiet HEAD`;
const {build}=await import(resolve(up,'node_modules/vite/dist/node/index.js'));
const plugin=()=>({name:'linux-fs-overlay',enforce:'pre',async load(id:string){
  if(id===resolve(up,'packages/runtime/node/internal/fs/watchers.js'))return patchPoll(await Bun.file(id).text());
  if(id===resolve(up,'packages/core/src/workers/fs-worker.ts'))return (await Bun.file(id).text()).replace('import { FsServer }',`import { installRemote } from ${JSON.stringify(resolve(root,'src/remote.js'))};\nimport { FsServer }`).replace('server = new FsServer(vfs, persistence);','server = new FsServer(vfs, persistence); installRemote(server);');
  if(['packages/runtime/fs-client.js','packages/kernel-host/kernel-fs.js'].some(p=>id===resolve(up,p)))return patchWait(await Bun.file(id).text());
}});
await build({configFile:false,root:resolve(up,'packages/core'),plugins:[plugin()],build:{target:'es2022',outDir:out,emptyOutDir:true,minify:false,lib:{entry:resolve(up,'packages/core/src/index.ts'),formats:['es'],fileName:()=> 'index.js'},rollupOptions:{output:{assetFileNames:'assets/[name]-[hash][extname]'}}},worker:{format:'es',plugins:()=>[plugin()]}});
await mkdir(resolve(out,'assets'),{recursive:true});
await copyFile(resolve(up,'packages/studio/public/sw.js'),resolve(out,'assets/sw.js'));
await copyFile(resolve(up,'LICENSE'),resolve(out,'assets/LICENSE.vivari.txt'));
const guest=(await Bun.file(resolve(root,'../qemu/guest/preview-bridge.ts')).text()).replace('if (type === "terminal-open") {','if (type === "fs") { send({id,type,...guestFs(message)}); } else if (type === "terminal-open") {');
await Bun.write(resolve(root,'.artifacts/guest-entry.ts'),`import {guestFs} from '../src/guest-fs';\n`+guest);
for(const [entry,outfile,target] of [['.artifacts/guest-entry.ts','.artifacts/guest.js','bun'],['src/main.ts','dist/main.js','browser']]) {
  const result=await Bun.build({entrypoints:[resolve(root,entry)],target:target as any});if(!result.success)throw Error(String(result.logs));await Bun.write(resolve(root,outfile),result.outputs[0]);
}
const hashes:any[]=[];
for(const name of ['src/remote.js','src/guest-fs.ts','scripts/poll-watch.ts','.artifacts/guest.js',...await Array.fromAsync(new Bun.Glob('**/*').scan({cwd:out,onlyFiles:true})).then(a=>a.map(p=>'.artifacts/runtime/'+p))]){
  const bytes=new Uint8Array(await Bun.file(resolve(root,name)).arrayBuffer());hashes.push({name,bytes:bytes.length,sha256:new Bun.CryptoHasher('sha256').update(bytes).digest('hex')});
}
await Bun.write(resolve(root,'runtime-build.json'),JSON.stringify({revision,bun:Bun.version,hashes},null,2)+'\n');

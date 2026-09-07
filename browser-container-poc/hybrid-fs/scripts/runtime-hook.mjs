import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {patchPoll} from './poll-watch.ts';
import {patchWait} from '../../hybrid/scripts/syscall-wait.ts';
const root=new URL('../../vivari/.runtime/baseline/',import.meta.url);
const waits=['packages/runtime/fs-client.js','packages/kernel-host/kernel-fs.js'].map(p=>new URL(p,root).href);
registerHooks({load(url,ctx,next){
  if(waits.includes(url))return {format:'module',source:patchWait(readFileSync(new URL(url),'utf8')),shortCircuit:true};
  if(url===new URL('packages/runtime/node/internal/fs/watchers.js',root).href)return {format:'module',source:patchPoll(readFileSync(new URL(url),'utf8')),shortCircuit:true};
  return next(url,ctx);
}});

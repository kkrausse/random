// Summarize already-captured browser evidence; this never executes a guest workload.
import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'..');
const sha=(bytes:Uint8Array)=>new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
const receipts:any[]=[];
for(const name of ['acceptance.json','acceptance-poll-runtime.json','hmr-before-poll-fix.json','hmr-pass.json']){
  const bytes=new Uint8Array(await Bun.file(resolve(root,'evidence',name)).arrayBuffer());
  receipts.push({name,sha256:sha(bytes),bytes:bytes.length,data:JSON.parse(new TextDecoder().decode(bytes))});
}
const summarize=(r:any)=>{
  if(r.phase!=='pass')throw Error('Filesystem acceptance did not pass');
  const times=r.warm.flatMap((x:any)=>x.samples.map((s:any)=>s.ms)).sort((a:number,b:number)=>a-b);
  return {phase:r.phase,basic:{ms:r.basic.ms,roundtrips:r.basic.roundtrips,linux:r.basic.linux},extended:{ms:r.extended.ms,roundtrips:r.extended.roundtrips,linux:r.extended.linux,output:r.extended.output},warm:r.warm.map((x:any)=>({ms:x.ms,roundtrips:x.roundtrips})),warmRpc:{n:times.length,median:times[Math.floor(times.length/2)],p95:times[Math.ceil(times.length*.95)-1],max:times.at(-1)}};
};
const final=receipts[3].data;if(final.hmr.phase!=='pass'||!final.hmr.restored||!final.hmr.samples.every((s:any)=>s.sameDocument))throw Error('HMR acceptance did not pass');
await Bun.write(resolve(root,'measurements.json'),JSON.stringify({origin:final.origin,browserControl:{session:'tidy-walrus-391',version:'0.7.0'},isolated:final.isolated,receipts:receipts.map(({data,...r})=>r),beforePollRuntime:summarize(receipts[0].data),finalPollRuntime:summarize(receipts[1].data),hmrNegativeControl:receipts[2].data.hmr,hmr:final.hmr,vite:final.vite,idle:final.idle},null,2)+'\n');

// Bun-backed Browser Control CLI: execute --session <id> --file profile.js
// Set state.profileLabel and state.profileMode ('shell' or 'tui') first.
// Run on an idle prompt; types synthetic letters, then removes them without submitting.
const label = state.profileLabel || 'baseline';
const mode = state.profileMode || 'shell';
if (!/^http:\/\/127\.0\.0\.1:521[67]\/$/.test(page.url())) throw Error('Select the demo');
await page.bringToFront();
await page.locator('.xterm-helper-textarea').focus();
await page.evaluate(() => {
  window.__perf?.dispose();
  const terminal = demo.terminal, now = () => performance.timeOrigin + performance.now();
  const screen = () => Array.from({length: terminal.rows}, (_, i) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + i)?.translateToString(true)).join('\n');
  const p = window.__perf = { started: now(), keys: [], output: {chunks:0, chars:0, parseMs:[]}, messages: {}, longTasks: [], renders:0, expected:'', matched:0, heap:performance.memory?.usedJSHeapSize };
  const key = e => { if (e.isTrusted) p.keys.push({keyAt:now()}); };
  document.querySelector('#terminal').addEventListener('keydown', key, true);
  const data = terminal.onData(() => { const k=p.keys.at(-1); if(k)k.dataAt=now(); });
  const render = terminal.onRender(() => {
    p.renders++;
    if (p.expected && screen().includes(p.expected)) {
      const k=p.keys.at(-1); if(k && !k.renderAt) { k.renderAt=now(); requestAnimationFrame(()=>{k.frameAt=now();p.matched++}); }
    }
  });
  const write = terminal.write;
  terminal.write = function(t, cb) {
    const at=now(); p.output.chunks++; p.output.chars+=t.length;
    const k=p.keys.at(-1); if(k&&!k.outputAt)k.outputAt=at;
    return write.call(this,t,()=>{p.output.parseMs.push(now()-at);if(p.output.parseMs.length>10000)p.output.parseMs.shift();cb?.()});
  };
  const off=demo.vm.bridge.onAny(m=>{p.messages[m.type]=(p.messages[m.type]||0)+1});
  const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())p.longTasks.push({at:e.startTime,ms:e.duration})});
  observer.observe({type:'longtask'});
  p.dispose=()=>{data.dispose();render.dispose();off();observer.disconnect();terminal.write=write;document.querySelector('#terminal').removeEventListener('keydown',key,true)};
});
const workers = [];
for (const w of page.workers().filter(w=>w.url().includes('process-worker'))) {
  const identity = await w.evaluate(() => {
    const ffi=process.getBuiltinModule('bun:ffi');
    ffi.vivariProfile?.(true);
    const p=globalThis.__inputPerf={pid:process.pid, arrivals:[], deliveries:[]};
    const now=()=>performance.timeOrigin+performance.now();
    const arrival=e=>{if(e.data?.type==='stdin')p.arrivals.push(now())};
    const delivery=()=>p.deliveries.push(now());
    globalThis.addEventListener('message',arrival);
    process.stdin.prependListener('data',delivery);
    p.dispose=()=>{globalThis.removeEventListener('message',arrival);process.stdin.removeListener('data',delivery)};
    return {pid:process.pid,role:process.argv[1]?.split('/').pop(),ffi:ffi.vivariStats?.()};
  });
  workers.push({w,identity});
}
const collect = async () => {
  const main=await page.evaluate(()=>JSON.parse(JSON.stringify({...window.__perf,heap:performance.memory?.usedJSHeapSize})));
  const processes=[];
  for(const {w,identity} of workers) processes.push({...identity, ...await w.evaluate(()=>({ffi:process.getBuiltinModule('bun:ffi').vivariStats?.(),input:globalThis.__inputPerf}))});
  return {main,processes};
};
const stages=[{name:'start',...await collect()}];
// Bounded observation interval, deliberately includes idle/render cycles.
await page.waitForTimeout(5000);
stages.push({name:'idle',...await collect()});
for(let batch=0;batch<3;batch++) {
  let token='';
  for(let i=0;i<32;i++) {
    token += 'abcdefghijklmnopqrstuvwxyz'[i%26];
    const matched=await page.evaluate(token=>{__perf.expected=token;return __perf.matched},token);
    await page.keyboard.press(token.at(-1));
    await page.waitForFunction(n=>__perf.matched>n,matched,{timeout:30000});
  }
  stages.push({name:`typed-${(batch+1)*32}`,...await collect()});
  await page.evaluate(()=>{__perf.expected=''});
  for(let i=0;i<32;i++)await page.keyboard.press('Backspace');
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(5000);
stages.push({name:'final-idle',...await collect()});
for(const {w} of workers) await w.evaluate(()=>{__inputPerf.dispose();process.getBuiltinModule('bun:ffi').vivariProfile?.(false)});
await page.evaluate(()=>__perf.dispose());
const report={label,mode,url:page.url(),at:new Date().toISOString(),stages};
const root='/Users/kkrausse/Documents/repos/kkrausse/random/browser-container-poc/opencode-demo';
fs.writeFileSync(path.join(root,`evidence/perf-${label}-${mode}.json`),JSON.stringify(report,null,2));
const keys=stages.at(-1).main.keys.filter(k=>k.frameAt);
const quantile=(a,q)=>a.sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(q*a.length))];
const summary={label,mode,keys:keys.length,latency:Object.fromEntries(['dataAt','outputAt','renderAt','frameAt'].map(stage=>{const a=keys.map(k=>k[stage]-k.keyAt);return [stage,{p50:quantile(a,.5),p95:quantile(a,.95),max:Math.max(...a)}]})),stages:stages.map(s=>({name:s.name,heap:s.main.heap,output:s.main.output.chars,renders:s.main.renders,ffi:s.processes.filter(p=>p.ffi).map(p=>({pid:p.pid,...p.ffi,symbols:undefined}))}))};
fs.writeFileSync(path.join(root,`evidence/perf-${label}-${mode}-summary.json`),JSON.stringify(summary,null,2));
return summary;

// Bun-backed browser-control execute --session <id> --file profile.js
// Empty idle prompt. Set state.profileLabel, profileMode, profilePids (inspected
// foreground chain only), profileBatches/Keys/IdleMs, profilePaced (default true).
const label=state.profileLabel||'baseline',mode=state.profileMode||'shell';
if(!/^[a-z0-9-]+$/.test(label)||!['shell','tui'].includes(mode))throw Error('Invalid name');
if(!/^http:\/\/127\.0\.0\.1:521[67]\/$/.test(page.url()))throw Error('Select demo');
const root='/Users/kkrausse/Documents/repos/kkrausse/random/browser-container-poc/terminal-agent-demo';
fs.mkdirSync(path.join(root,'evidence'),{recursive:true});
const file=path.join(root,`evidence/perf-${label}-${mode}.json`);
if(fs.existsSync(file))throw Error('Use a fresh label; preserve prior evidence');
const report={label,mode,url:page.url(),at:new Date().toISOString(),config:{pids:state.profilePids||[],batches:state.profileBatches??3,keys:state.profileKeys??32,idleMs:state.profileIdleMs??5000,paced:state.profilePaced!==false},progress:[],stages:[],cleanup:[]};
const save=step=>{report.progress.push({step,at:new Date().toISOString()});fs.writeFileSync(file,JSON.stringify(report,null,2))};
// Deadline cannot cancel remote evaluate: abort on failure instead of flooding
// a blocked worker. Incremental receipts + bounded cleanup + auto-dispose backstop.
const bounded=async(name,fn)=>{let timer;save(`begin:${name}`);try{return await Promise.race([fn(),new Promise((_,r)=>{timer=setTimeout(()=>r(Error(`${name}: inspection deadline (NOT UI latency)`)),2500)})])}finally{clearTimeout(timer)}};
const workers=[];
save('created');
try{
  await bounded('focus',async()=>{await page.bringToFront();await page.locator('.xterm-helper-textarea').focus()});
  await bounded('main-install',()=>page.evaluate(()=>{
    window.__perf?.dispose();
    const terminal=demo.terminal,now=()=>performance.timeOrigin+performance.now();
    const screen=()=>Array.from({length:terminal.rows},(_,i)=>terminal.buffer.active.getLine(terminal.buffer.active.viewportY+i)?.translateToString(true)).join('\n');
    const p=window.__perf={started:now(),keys:[],unexpected:0,armed:null,output:{chunks:0,chars:0,parseMs:[]},messages:{},longTasks:[],renders:0,expected:'',matched:0};
    const key=e=>{if(!e.isTrusted)return;const expected=p.armed===e.key;p.armed=null;if(!expected)p.unexpected++;if(p.keys.length<10000)p.keys.push({keyAt:now(),expected,letter:e.key.length===1,focused:document.activeElement===terminal.textarea})};
    document.querySelector('#terminal').addEventListener('keydown',key,true);
    const data=terminal.onData(()=>{const k=p.keys.at(-1);if(k)k.dataAt=now()});
    const render=terminal.onRender(()=>{p.renders++;if(p.expected&&screen().includes(p.expected)){const k=p.keys.at(-1);if(k&&!k.renderAt){k.renderAt=now();requestAnimationFrame(()=>{k.frameAt=now();p.matched++})}}});
    const write=terminal.write;
    terminal.write=function(t,cb){const at=now();p.output.chunks++;p.output.chars+=t.length;const k=p.keys.at(-1);if(k&&!k.outputAt)k.outputAt=at;return write.call(this,t,()=>{if(p.output.parseMs.length<10000)p.output.parseMs.push(now()-at);cb?.()})};
    const off=demo.vm.bridge.onAny(m=>{p.messages[m.type]=(p.messages[m.type]||0)+1});
    const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(p.longTasks.length<1000)p.longTasks.push({at:e.startTime,ms:e.duration})});observer.observe({type:'longtask'});
    let disposed=false;
    p.dispose=()=>{if(disposed)return;disposed=true;clearTimeout(expiry);data.dispose();render.dispose();off();observer.disconnect();terminal.write=write;document.querySelector('#terminal').removeEventListener('keydown',key,true)};
    const expiry=setTimeout(p.dispose,180000);
  }));
  for(const w of page.workers().filter(w=>w.url().includes('process-worker'))){
    const identity=await bounded('identity',()=>w.evaluate(()=>({pid:process.pid,role:process.argv[1],serve:process.argv.includes('serve'),hasFfi:!!process.getBuiltinModule('bun:ffi').vivariStats?.()})));
    report.progress.push({identity});if(!report.config.pids.includes(identity.pid))continue;
    workers.push({w,identity});
    await bounded(`install:${identity.pid}`,()=>w.evaluate(()=>{
      globalThis.__inputPerf?.dispose();
      const ffi=process.getBuiltinModule('bun:ffi');ffi.vivariProfile?.(true);
      const p=globalThis.__inputPerf={pid:process.pid,arrivals:[],deliveries:[],loopDelay:[]};
      const now=()=>performance.timeOrigin+performance.now();
      const arrival=e=>{if(e.data?.type==='stdin'&&p.arrivals.length<10000)p.arrivals.push(now())};
      const delivery=()=>{if(p.deliveries.length<10000)p.deliveries.push(now())};
      // A later message listener can include synchronous dispatch work. Wrap
      // the existing handler so arrival is recorded BEFORE guest dispatch.
      const onmessage=globalThis.onmessage;
      const wrapped=function(e){arrival(e);return onmessage.call(this,e)};
      globalThis.onmessage=wrapped;process.stdin.prependListener('data',delivery);
      let last=now();const tick=setInterval(()=>{const at=now();if(p.loopDelay.length<4000)p.loopDelay.push(at-last-50);last=at},50);tick.unref?.();
      p.dispose=()=>{clearTimeout(expiry);clearInterval(tick);if(globalThis.onmessage===wrapped)globalThis.onmessage=onmessage;process.stdin.removeListener('data',delivery);ffi.vivariProfile?.(false)};
      const expiry=setTimeout(p.dispose,180000);expiry.unref?.();
    }));
  }
  if(workers.length!==report.config.pids.length)throw Error('Missing requested worker');
  if(mode==='tui'&&!workers.some(({identity:i})=>i.hasFfi&&!i.serve&&i.role==='/opencode-v2/cli/entry.cjs'))throw Error('No active foreground TUI FFI worker');
  const collect=async name=>{
    const stage={name,main:await bounded(`main:${name}`,()=>page.evaluate(()=>JSON.parse(JSON.stringify({...__perf,heap:performance.memory?.usedJSHeapSize})))),processes:[]};
    report.stages.push(stage);save(`main-saved:${name}`);
    for(const {w,identity} of workers){stage.processes.push({...identity,...await bounded(`read:${identity.pid}:${name}`,()=>w.evaluate(()=>({ffi:process.getBuiltinModule('bun:ffi').vivariStats?.(),input:JSON.parse(JSON.stringify(globalThis.__inputPerf))})))});save(`worker-saved:${identity.pid}:${name}`)}
  };
  await collect('start');
  if(mode==='tui'&&!report.stages[0].processes.some(p=>p.hasFfi&&p.ffi?.profiling))throw Error('TUI profiling was not enabled');
  await page.waitForTimeout(report.config.idleMs);await collect('idle');
  for(let batch=0;batch<report.config.batches;batch++){
    let token='';const start=Date.now();
    for(let i=0;i<report.config.keys;i++){
      token+='abcdefghijklmnopqrstuvwxyz'[i%26];
      const matched=await bounded(`expect:${batch}:${i}`,()=>page.evaluate(token=>{if(__perf.unexpected)throw Error('Unexpected trusted input; discard run');__perf.expected=token;__perf.armed=token.at(-1);return __perf.matched},token));
      await bounded(`key:${batch}:${i}`,()=>page.keyboard.press(token.at(-1)));
      if(report.config.paced)await page.waitForFunction(n=>__perf.matched>n,matched,{timeout:3000});
      save(`key-sent:${batch}:${i}`);
    }
    await page.waitForFunction(token=>{const t=demo.terminal;return Array.from({length:t.rows},(_,i)=>t.buffer.active.getLine(t.buffer.active.viewportY+i)?.translateToString(true)).join('\n').includes(token)},token,{timeout:5000});
    report.progress.push({batch,typingMs:Date.now()-start});await collect(`typed-${(batch+1)*report.config.keys}`);
    await bounded('clear-expect',()=>page.evaluate(()=>{__perf.expected=''}));
    for(let i=0;i<report.config.keys;i++){await page.evaluate(()=>{__perf.armed='Backspace'});await bounded(`erase:${batch}:${i}`,()=>page.keyboard.press('Backspace'));}
    await page.waitForTimeout(1500);
  }
  await collect('erased');
  await page.waitForTimeout(report.config.idleMs);await collect('final-idle');
  const final=report.stages.at(-1).main;
  if(final.unexpected||final.keys.length!==report.config.batches*report.config.keys*2||final.keys.some(k=>!k.focused||!k.dataAt))throw Error('Unexpected, missing, or unfocused input; discard run');
  report.complete=true;
}catch(e){report.error=String(e);save('failed');
  try{report.stages.push({name:'failure',main:await bounded('failure-main',()=>page.evaluate(()=>JSON.parse(JSON.stringify({...__perf,heap:performance.memory?.usedJSHeapSize})))),processes:[]})}catch{}
}
finally{
  for(const {w,identity} of workers)try{await bounded(`cleanup:${identity.pid}`,()=>w.evaluate(()=>globalThis.__inputPerf?.dispose()));report.cleanup.push({pid:identity.pid,ok:true})}catch(e){report.cleanup.push({pid:identity.pid,error:String(e)})}
  try{await bounded('cleanup:main',()=>page.evaluate(()=>window.__perf?.dispose()));report.cleanup.push({main:true,ok:true})}catch(e){report.cleanup.push({main:true,error:String(e)})}
  save('finished');
}
const quantiles=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?{p50:a[Math.floor(.5*a.length)],p95:a[Math.min(a.length-1,Math.floor(.95*a.length))],max:a.at(-1)}:null};
const keys=report.stages.at(-1)?.main.keys.filter(k=>k.letter&&k.frameAt)||[];
const summary={label,mode,complete:!!report.complete,error:report.error,keys:report.stages.at(-1)?.main.keys.filter(k=>k.letter).length||0,renderedKeys:keys.length,measurement:report.config.paced?'paced key-to-paint-opportunity':'unpaced batch completion (renders coalesce; not per-key latency)',batches:report.progress.filter(p=>p.batch!==undefined),latency:report.config.paced?Object.fromEntries(['dataAt','outputAt','renderAt','frameAt'].map(s=>[s,quantiles(keys.map(k=>k[s]-k.keyAt))])):null,stages:report.stages.map(s=>({name:s.name,heap:s.main.heap,output:s.main.output.chars,renders:s.main.renders,ffi:s.processes.map(p=>({pid:p.pid,...p.ffi,symbols:undefined}))}))};
fs.writeFileSync(file.replace('.json','-summary.json'),JSON.stringify(summary,null,2));
return summary;

await page.evaluate(()=>{
  window.fsVite={phase:'loading-dependencies',logs:[],started:performance.now()};
  (async()=>{
    const vm=window.fsSpike.vm,r=window.fsVite;
    const manifest=await(await fetch('/deps-manifest.json')).json();
    const compressed=new Uint8Array(await(await fetch('/vendor/hybrid-deps.bin')).arrayBuffer());
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',compressed)),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==manifest.sha256)throw Error('Dependency pack digest mismatch');
    const files=JSON.parse(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
    const decoded={};for(const [path,encoded] of Object.entries(files))if(path.startsWith('node_modules/')&&!path.split('/').includes('..'))decoded[path]=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    const result=await vm.bridge.request('vv-create-project',{dir:'/workspace',files:decoded});if(!result.ok)throw Error(result.error);
    r.dependencies={files:Object.keys(decoded).length,sha256:hash};
    const preview=document.createElement('iframe');preview.id='preview';preview.style.cssText='width:100%;height:400px';document.body.insertBefore(preview,document.querySelector('#log'));
    for(const type of ['vv-ws','vv-sse'])vm.bridge.on(type,event=>preview.contentWindow.postMessage({...event.msg,type,dir:'in'},location.origin));
    vm.on('server-ready',(port,url)=>{if(port===5173){r.phase='serving';r.serverReadyMs=performance.now()-r.started;preview.src=url;}});
    r.phase='starting';r.before=window.fsSpike.samples.length;
    const p=await vm.spawn('node',['node_modules/vite/bin/vite.js','--host','0.0.0.0','--port','5173','--strictPort'],{cwd:'/workspace',env:{CHOKIDAR_USEPOLLING:'true',CHOKIDAR_INTERVAL:'2000'}});r.process=p;
    void(async()=>{for await(const s of p.output){r.logs.push(s);document.querySelector('#log').textContent+=s;}})();
    void p.exit.then(code=>{r.exit=code;if(r.phase!=='stopped')r.phase='exited';});
  })().catch(e=>{window.fsVite.phase='failed';window.fsVite.error=String(e);});
});
return {started:true};

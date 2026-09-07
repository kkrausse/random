// browser-control execute --session SESSION --file .../hybrid-ffi/accept.js
return await page.evaluate(async () => {
  const h = window.hybrid;
  const source = await (await fetch('/guest.ts')).text();
  const b64 = btoa(source);
  const installed = await h.exec(`printf '%s' '${b64}' | base64 -d > /tmp/hybrid-ffi.ts; BUN_JSC_useFTLJIT=false bun /tmp/hybrid-ffi.ts >/tmp/hybrid-ffi.log 2>&1 </dev/null & echo $! >/tmp/hybrid-ffi.pid; for i in $(seq 1 90); do test -f /tmp/hybrid-ffi-ready && exit 0; sleep 1; done; cat /tmp/hybrid-ffi.log; exit 1`);
  await h.boot();
  const valid = [
    {bytes: [], needle: 0, signed: 0},
    {bytes: [0,255,128,0], needle:255, signed:-2147483647},
    {bytes: [65,0,66,255], needle:66, signed:2147483647},
    {bytes: [7,7,8], needle:7, signed:-73},
    {bytes: [7,7,8], needle:9, signed:123456},
    ...Array.from({length:15},(_,i)=>({bytes:Array.from({length:256},(_,j)=>(j+i)%256),needle:255-i,signed:-1000-i})),
  ].map(c=>({op:'scan-v1',...c}));
  const invalid = [
    {...valid[1], pointer:123}, {...valid[1], callback:'call-me'},
    {...valid[1], bytes:[256]}, {...valid[1], signed:-2147483648},
    {...valid[1], needle:1.5}, {...valid[1], op:'dlopen'},
  ].map(c=>({...c,expectError:true}));
  await h.vm.fs.writeFile('/workspace/ffi-cases.json',JSON.stringify([...valid,...invalid]));
  await h.vm.fs.writeFile('/workspace/ffi-client.cjs',await (await fetch('/client.cjs')).text());
  window.ffiEvidence = {phase:'running', installed};
  const proc = await h.vm.spawn('node',['/workspace/ffi-client.cjs'],{cwd:'/workspace'});
  let pending = '';
  void (async()=>{
    try {
      for await (const text of proc.output) {
        pending += text;
        let end;
        while ((end=pending.indexOf('\n'))>=0) {
          const line=pending.slice(0,end); pending=pending.slice(end+1);
          if (line.startsWith('FFI_REQUEST ')) {
            const {id,input} = JSON.parse(line.slice(12));
            delete input.expectError;
            const start=performance.now();
            const r=await h.bridge.request({type:'http',method:'GET',path:'/?q='+encodeURIComponent(JSON.stringify(input))});
            if(r.error) throw Error(r.error);
            const bytes=Uint8Array.from(atob(r.body),c=>c.charCodeAt(0));
            const body=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
            const response={status:r.status,body,bridgeRoundTripMs:performance.now()-start,guestHttpTiming:r.timing};
            const path='/workspace/ffi-reply-'+id+'.json';
            await h.vm.fs.writeFile(path+'.tmp',JSON.stringify(response));
            await h.vm.fs.rename(path+'.tmp',path);
          } else if(line.startsWith('FFI_COMPLETE ')) window.ffiEvidence.results=JSON.parse(line.slice(13));
          else (window.ffiEvidence.logs??=[]).push(line);
        }
      }
      window.ffiEvidence.code=await proc.exit;
      window.ffiEvidence.phase=window.ffiEvidence.code===0&&window.ffiEvidence.results?'complete':'failed';
    } catch(e) {window.ffiEvidence.phase='failed';window.ffiEvidence.error=String(e);proc.kill();}
  })();
  return {phase:window.ffiEvidence.phase};
});

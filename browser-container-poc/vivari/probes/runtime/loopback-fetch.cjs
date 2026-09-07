const assert = require('node:assert/strict');
if (process.argv[2] === 'server') {
  require('node:http').createServer((req,res)=>{
    if(req.url === '/stream') {
      res.writeHead(200, {'content-type':'text/event-stream'});res.write('data: first\n\n');
      const timer=setInterval(()=>res.write('data: next\n\n'),100);
      res.on('close',()=>clearInterval(timer));return;
    }
    if(req.url === '/redirect') {res.writeHead(302,{location:'/echo'});res.end();return;}
    if(req.url === '/empty') {res.writeHead(204);res.end();return;}
    if(req.url !== '/echo') {res.writeHead(404);res.end('missing');return;}
    const parts=[];req.on('data',c=>parts.push(c));req.on('end',()=>{
      res.writeHead(201,{'content-type':'application/octet-stream','x-method':req.method,'x-input':req.headers['x-input']||''});
      res.end(Buffer.concat(parts));
    });
  }).listen(4097,'127.0.0.1',()=>console.log('FETCH_SERVER_READY'));
} else (async()=>{
  const child=require('node:child_process').spawn('node',[__filename,'server']);
  try {
    await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(d.toString().includes('FETCH_SERVER_READY'))resolve()});child.on('error',reject)});
    const base='http://127.0.0.1:4097';
    const response=await fetch(new Request(base+'/echo',{method:'POST',headers:{'x-input':'preserved'},body:new Uint8Array([0,1,255,42])}));
    assert.equal(response.status,201);assert.equal(response.url,base+'/echo');
    assert.equal(response.headers.get('x-method'),'POST');assert.equal(response.headers.get('x-input'),'preserved');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[0,1,255,42]);
    assert.equal((await fetch(base+'/missing')).status,404);
    assert.equal(await (await fetch(base+'/empty')).text(),'');
    assert.equal((await fetch(base+'/redirect',{redirect:'manual'})).status,302);
    await assert.rejects(()=>fetch(base+'/redirect'),/redirects are unsupported/);
    const abort=new AbortController();
    const stream=await fetch(base+'/stream',{signal:abort.signal});
    const reader=stream.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value),'data: first\n\n');
    abort.abort(new Error('probe-abort'));
    await assert.rejects(()=>reader.read(),/probe-abort/);
    await assert.rejects(()=>fetch(base+'/echo',{signal:abort.signal}),/probe-abort/);
    console.log('LOOPBACK_FETCH_PASS cross-worker/binary/headers/status/stream/abort/redirect-rejection');
  } finally {child.kill();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});

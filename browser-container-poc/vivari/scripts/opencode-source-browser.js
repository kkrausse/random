if(page.url() !== 'http://127.0.0.1:5205/') throw Error('Use isolated :5205');
const root = state.ffiRoot || [path.resolve('browser-container-poc/vivari'),path.resolve('vivari'),path.resolve('.')].find(p=>fs.existsSync(path.join(p,'scripts/ffi-browser.js')));
const receipt=JSON.parse(fs.readFileSync(path.join(root,'.runtime/opencode-tui-package/receipt.json'),'utf8'));
const refresh=state.opencodeRefreshMode || (state.opencodeRefreshApp?'app':null);
const delivery=[];
for(const asset of receipt.assets.filter(a=>!refresh || a.mode===refresh)) {
  const bytes=fs.readFileSync(path.join(root,'.runtime/opencode-tui-package',asset.file));
  for(let off=0,part=0;off<bytes.length;off+=262144,part++) await page.evaluate(async ({part,bytes})=>{await window.probe.vm.fs.writeFile('/ffi-probe/part-'+part,new Uint8Array(bytes));},{part,bytes:Array.from(bytes.subarray(off,off+262144))});
  const result=await page.evaluate(async ({destination,count})=>{
    const p=await window.probe.vm.spawn('node',['-e',`const fs=require('fs');const p=${JSON.stringify(destination)};fs.mkdirSync(require('path').dirname(p),{recursive:true});const fd=fs.openSync(p,'w');for(let i=0;i<${count};i++){const part='/ffi-probe/part-'+i;fs.writeSync(fd,fs.readFileSync(part));fs.unlinkSync(part)}fs.closeSync(fd);console.log(require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'));`]);
    let output='';const drain=(async()=>{for await(const t of p.output)output+=t})();const code=await p.exit;await drain;return {code,output};
  },{destination:asset.destination,count:Math.ceil(bytes.length/262144)});
  if(result.code!==0 || !result.output.includes(asset.sha256)) throw Error(JSON.stringify(result));
  delivery.push({...asset,verifiedInGuest:true});
}
if (!refresh) await page.evaluate(async ()=>{
  if(window.opencodeSource?.server) throw Error('Source server already owned');
  const report=window.opencodeSource={phase:'starting',serverOutput:'',appOutput:''};
  const server=await window.probe.vm.spawn('node',['/opencode-tui/cli/entry.cjs','serve','--port','4096','--register'],{cwd:'/workspace'});
  report.server=server;
  report.serverDrain=(async()=>{for await(const t of server.output)report.serverOutput+=t})();
  server.exit.then(code=>{report.serverCode=code;report.phase='server-exited';});
  await window.probe.vm.fs.writeFile('/ffi-probe/opencode-app.cjs',`require('/opencode-tui/app/entry.cjs');`);
});
const result={url:page.url(),receipt,delivery,runtime:JSON.parse(fs.readFileSync(path.join(root,'.runtime/patched-build.json'),'utf8'))};
const installer=fs.readFileSync(path.join(root,'probes/runtime/install-opencode-launcher.cjs'),'utf8');
result.launcher=await page.evaluate(async source=>{
  const p=await window.probe.vm.spawn('node',['-e',source]);
  let output='';const drain=(async()=>{for await(const t of p.output)output+=t})();
  const code=await p.exit;await drain;if(code!==0)throw Error(output);return {code,output};
},installer);
fs.writeFileSync(path.join(root,`../doc/logs/vivari/wire-opencode-browser${refresh?'-'+refresh:''}.json`),JSON.stringify(result,null,2));
return {phase:refresh?'delivered-'+refresh:'delivered-server-started',assets:delivery.length,bytes:delivery.reduce((n,a)=>n+a.bytes,0)};

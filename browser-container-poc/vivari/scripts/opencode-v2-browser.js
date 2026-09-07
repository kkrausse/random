if (page.url() !== (state.v2Origin || 'http://127.0.0.1:5206/')) throw Error('Use isolated V2 origin');
const root = state.ffiRoot || [path.resolve('browser-container-poc/vivari'), path.resolve('vivari'), path.resolve('.')].find(p => fs.existsSync(path.join(p, 'scripts/ffi-browser.js')));
const receipt = JSON.parse(fs.readFileSync(path.join(root, '.runtime/opencode-v2-package/receipt.json'), 'utf8'));
for (const asset of receipt.assets) {
  const present=await page.evaluate(async asset=>{
    const p=await window.probe.vm.spawn('node',['-e',`const fs=require('fs');const p=${JSON.stringify(asset.destination)};if(fs.existsSync(p))console.log(require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'));`]);
    let output='';const drain=(async()=>{for await(const t of p.output)output+=t})();const code=await p.exit;await drain;return code===0&&output.trim()===asset.sha256;
  },asset);
  if(present)continue;
  const bytes = fs.readFileSync(path.join(root, '.runtime/opencode-v2-package', asset.file));
  for (let off = 0, part = 0; off < bytes.length; off += 262144, part++) {
    await page.evaluate(async ({part, bytes}) => window.probe.vm.fs.writeFile('/ffi-probe/v2-part-' + part, new Uint8Array(bytes)), {part, bytes:Array.from(bytes.subarray(off, off + 262144))});
  }
  await page.evaluate(async ({asset, count}) => {
    const p = await window.probe.vm.spawn('node', ['-e', `const fs=require('fs');const dest=${JSON.stringify(asset.destination)};fs.mkdirSync(require('path').dirname(dest),{recursive:true});const fd=fs.openSync(dest,'w');for(let i=0;i<${count};i++){const part='/ffi-probe/v2-part-'+i;fs.writeSync(fd,fs.readFileSync(part));fs.unlinkSync(part)}fs.closeSync(fd);console.log(require('crypto').createHash('sha256').update(fs.readFileSync(dest)).digest('hex'));`]);
    let output='';const drain=(async()=>{for await(const t of p.output)output+=t})();const code=await p.exit;await drain;
    if(code!==0 || !output.includes(asset.sha256))throw Error(output);
  }, {asset, count:Math.ceil(bytes.length / 262144)});
}
await page.evaluate(async () => {
  const env = {XDG_DATA_HOME:'/home/user/vivari-v2/data',XDG_CONFIG_HOME:'/home/user/vivari-v2/config',XDG_CACHE_HOME:'/home/user/vivari-v2/cache',XDG_STATE_HOME:'/home/user/vivari-v2/state',OPENCODE_MODELS_PATH:'/opencode-v2/models.json',OPENCODE_DISABLE_MODELS_FETCH:'1',OPENCODE_DISABLE_FFF:'1',OPENCODE_DISABLE_FILEWATCHER:'1'};
  window.opencodeV2 ??= {output:'', env};
  env.OTUI_TREE_SITTER_WORKER_PATH='/opencode-v2/parser/entry.cjs';
  await window.probe.vm.fs.writeFile('/opencode-v2/run.cjs', `const child=require('child_process').spawn('bun',['/opencode-v2/cli/entry.cjs',...process.argv.slice(2)],{stdio:['pipe','inherit','inherit'],env:{...process.env,...${JSON.stringify(env)}}});process.stdin.on('data',chunk=>child.stdin.write(chunk));process.stdin.once('end',()=>child.stdin.end());process.on('SIGINT',()=>child.kill('SIGINT'));child.on('error',e=>{console.error(e.message);process.exitCode=1});child.on('exit',code=>{process.stdin.pause();process.exitCode=code??1});`);
  if (window.opencodeV2.server && window.opencodeV2.code === undefined) return;
  window.opencodeV2.output = '';
  delete window.opencodeV2.code;
  const server=await window.probe.vm.spawn('node',['/opencode-v2/run.cjs','serve','--service','--port','4106'],{cwd:'/workspace'});
  window.opencodeV2.server=server;
  window.opencodeV2.drain=(async()=>{for await(const t of server.output)window.opencodeV2.output+=t})();
  server.exit.then(code=>{window.opencodeV2.code=code});
});
fs.writeFileSync(path.join(root,'../doc/logs/vivari/v2-delivery.json'),JSON.stringify({url:page.url(),receipt,verifiedInGuest:true},null,2));
const installer=fs.readFileSync(path.join(root,'probes/runtime/install-opencode-launcher.cjs'),'utf8');
await page.evaluate(async source=>{
  const p=await window.probe.vm.spawn('node',['-e',source],{env:{VIVARI_OPENCODE_PROFILE:'v2'}});
  let output='';const drain=(async()=>{for await(const t of p.output)output+=t})();const code=await p.exit;await drain;
  if(code!==0)throw Error(output);
},installer);
await page.evaluate(()=>{
  const hint=document.querySelector('#opencode-launch-hint') || document.createElement('p');
  hint.id='opencode-launch-hint';
  hint.textContent='OpenCode TUI installed: run opencode2 in the guest shell. For longer prompts use a fresh opencode2 --prompt "...", wait for the text, then press Enter. Ctrl+C returns to the shell.';
  document.querySelector('#shell-tabs').before(hint);
});
return {delivered:receipt.assets.length,bytes:receipt.assets.reduce((n,a)=>n+a.bytes,0),server:'starting',command:'node /opencode-v2/run.cjs'};

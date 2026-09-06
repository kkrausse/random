if (page.url() !== 'http://127.0.0.1:5202/') throw Error('Use isolated :5202');
const root = state.wasmTuiRoot || [path.resolve('browser-container-poc/vivari'),path.resolve('vivari'),path.resolve('.')].find(p=>fs.existsSync(path.join(p,'scripts/wasm-tui-browser.js')));
if(!root) throw Error('Set state.wasmTuiRoot to the Vivari POC directory');
const assets = [
  ['opentui.wasm', '.runtime/opentui-source/packages/core/src/zig/zig-out/bin/opentui.wasm'],
  ['core.cjs', 'probes/tui/wasm-core.cjs'],
  ['positional.cjs', 'probes/runtime/wasi-positional.cjs'],
  ['positional.wasm', '.runtime/wasi-positional.wasm'],
];
const delivery = [];
for (const [name, file] of assets) {
  const bytes = fs.readFileSync(path.join(root,file));
  await page.evaluate(async () => { await window.probe.vm.fs.mkdir('/wasm-tui',{recursive:true}); });
  for (let off=0, part=0; off<bytes.length; off+=262144,part++) {
    await page.evaluate(async ({part,data}) => { await window.probe.vm.fs.writeFile('/wasm-tui/part-'+part,new Uint8Array(data)); }, {part,data:Array.from(bytes.subarray(off,off+262144))});
  }
  const count = Math.ceil(bytes.length/262144);
  const output = await page.evaluate(async ({name,count}) => {
    const proc = await window.probe.vm.spawn('node',['-e',`const fs=require('fs');const fd=fs.openSync('/wasm-tui/${name}','w');for(let i=0;i<${count};i++){let p='/wasm-tui/part-'+i;fs.writeSync(fd,fs.readFileSync(p));fs.unlinkSync(p)}fs.closeSync(fd);console.log(require('crypto').createHash('sha256').update(fs.readFileSync('/wasm-tui/${name}')).digest('hex'));`]);
    let out=''; const drain=(async()=>{for await(const t of proc.output)out+=t})();
    const code=await proc.exit; await drain; return {code,out};
  },{name,count});
  const hash = modules.crypto.createHash('sha256').update(bytes).digest('hex');
  if(output.code!==0 || !output.out.includes(hash)) throw Error(JSON.stringify(output));
  delivery.push({name,bytes:bytes.length,sha256:hash,verifiedInGuest:true});
}
await page.evaluate(r=>window.wasmTuiDelivery=r,{assets:delivery,build:JSON.parse(fs.readFileSync(path.join(root,'.runtime/opentui-wasm-build.json'),'utf8')),runtime:JSON.parse(fs.readFileSync(path.join(root,'.runtime/patched-build.json'),'utf8'))});
return 'Delivered and SHA-256 verified in worker. Launch node /wasm-tui/core.cjs in Shell 1.';

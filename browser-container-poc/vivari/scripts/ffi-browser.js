if (page.url() !== 'http://127.0.0.1:5203/') throw Error('Use isolated :5203');
const root = state.ffiRoot || [path.resolve('browser-container-poc/vivari'), path.resolve('vivari'), path.resolve('.')].find(p => fs.existsSync(path.join(p, 'scripts/ffi-browser.js')));
if (!root) throw Error('Set state.ffiRoot to the Vivari checkout');
const receipt = JSON.parse(fs.readFileSync(path.join(root, '.runtime/tui-package/receipt.json'), 'utf8'));
const assets = [
  ['/ffi-probe/ffi-library.wasm', '.runtime/ffi-library.wasm'],
  ['/ffi-probe/ffi-library.ffi.json', '.runtime/ffi-library.ffi.json'],
  ['/ffi-probe/contract.cjs', 'probes/runtime/ffi-contract.cjs'],
  ['/ffi-probe/opentui.wasm', '.runtime/opentui-source/packages/core/src/zig/zig-out/bin/opentui.wasm'],
  ['/ffi-probe/opentui.ffi.json', '.runtime/opentui.ffi.json'],
  ...receipt.assets.filter(x => x.target === 'node').map(x => [x.destination, '.runtime/tui-package/' + x.file]),
];
const delivery = [];
await page.evaluate(async () => { await window.probe.vm.fs.mkdir('/ffi-probe', {recursive:true}); });
for (const [destination, file] of assets) {
  const bytes = fs.readFileSync(path.join(root, file));
  for (let off = 0, part = 0; off < bytes.length; off += 262144, part++) {
    await page.evaluate(async ({part, data}) => { await window.probe.vm.fs.writeFile('/ffi-probe/part-' + part, new Uint8Array(data)); }, {part, data: Array.from(bytes.subarray(off, off + 262144))});
  }
  const result = await page.evaluate(async ({destination, count}) => {
    const proc = await window.probe.vm.spawn('node', ['-e', `const fs=require('fs');const p=${JSON.stringify(destination)};fs.mkdirSync(require('path').dirname(p),{recursive:true});const fd=fs.openSync(p,'w');for(let i=0;i<${count};i++){const part='/ffi-probe/part-'+i;fs.writeSync(fd,fs.readFileSync(part));fs.unlinkSync(part)}fs.closeSync(fd);console.log(require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'));`]);
    let output = ''; const drain = (async () => { for await (const t of proc.output) output += t; })();
    const code = await proc.exit; await drain; return {code, output};
  }, {destination, count: Math.ceil(bytes.length / 262144)});
  const sha256 = modules.crypto.createHash('sha256').update(bytes).digest('hex');
  if (result.code !== 0 || !result.output.includes(sha256)) throw Error(JSON.stringify(result));
  delivery.push({destination, bytes: bytes.length, sha256, verifiedInGuest: true});
}
const cases = await page.evaluate(async () => {
  async function run(command, args, env = {}) {
    const proc = await window.probe.vm.spawn(command, args, {env, terminal: {cols:100, rows:30}});
    const timer = setTimeout(() => proc.kill(), 20000);
    let output = ''; const drain = (async () => { for await (const t of proc.output) output += t; })();
    try { const code = await proc.exit; await drain; return {code, output}; } finally { clearTimeout(timer); }
  }
  const contract = await run('bun', ['/ffi-probe/contract.cjs']);
  const opentui = await run('node', ['/tui-probe/node/renderer.cjs'], {VV_TUI_FFI_ARTIFACT:'/ffi-probe/opentui.ffi.json'});
  return {contract, opentui};
});
const result = {
  url: page.url(), delivery, cases,
  runtime: JSON.parse(fs.readFileSync(path.join(root, '.runtime/patched-build.json'), 'utf8')),
  opentuiBuild: JSON.parse(fs.readFileSync(path.join(root, '.runtime/opentui-wasm-build.json'), 'utf8')),
  layout: JSON.parse(fs.readFileSync(path.join(root, '.runtime/ffi-layout-report.json'), 'utf8')),
  ffiPass: cases.contract.code === 0 && cases.contract.output.includes('FFI_CONTRACT_PASS'),
  opentuiGate: 'BLOCKED: missing audio export; native64 struct ABI also differs',
};
await page.evaluate(r => window.ffiQualification = r, result);
fs.writeFileSync(path.join(root, '../doc/logs/vivari/ffi-browser.json'), JSON.stringify(result, null, 2) + '\n');
if (!result.ffiPass) throw Error(JSON.stringify(cases.contract));
if (cases.opentui.code !== 1 || !cases.opentui.output.includes('missing export createAudioEngine')) throw Error(JSON.stringify(cases.opentui));
return {ffiPass: result.ffiPass, opentuiGate: result.opentuiGate, cases};

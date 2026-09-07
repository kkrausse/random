if (page.url() !== (state.ffiOrigin || 'http://127.0.0.1:5204/')) throw Error('Use the explicitly selected isolated origin');
const root = state.ffiRoot || [path.resolve('browser-container-poc/vivari'), path.resolve('vivari'), path.resolve('.')].find(p => fs.existsSync(path.join(p, 'scripts/ffi-browser.js')));
if (!root) throw Error('Set state.ffiRoot to the Vivari checkout');
const receipt = JSON.parse(fs.readFileSync(path.join(root, '.runtime/tui-package/receipt.json'), 'utf8'));
const assets = [
  ['/ffi-probe/ffi-library.wasm', '.runtime/ffi-library.wasm'],
  ['/ffi-probe/ffi-library.ffi.json', '.runtime/ffi-library.ffi.json'],
  ['/ffi-probe/contract.cjs', 'probes/runtime/ffi-contract.cjs'],
  ['/ffi-probe/opentui.wasm', '.runtime/opentui-source/packages/core/src/zig/zig-out/bin/opentui.wasm'],
  ['/ffi-probe/opentui.ffi.json', '.runtime/opentui.ffi.json'],
  ['/ffi-probe/reject.cjs', 'probes/runtime/opentui-wire-reject.cjs'],
  ['/ffi-probe/loopback-fetch.cjs', 'probes/runtime/loopback-fetch.cjs'],
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
  const loopback = await run('node', ['/ffi-probe/loopback-fetch.cjs']);
  const rejection = [];
  for (const mode of ['wide','range','audio']) rejection.push(await run('node', ['/ffi-probe/reject.cjs', mode]));
  await window.probe.vm.fs.writeFile('/ffi-probe/tui.cjs', 'process.env.VV_TUI_FFI_ARTIFACT="/ffi-probe/opentui.ffi.json";require("/tui-probe/node/renderer.cjs");');
  return {contract, loopback, rejection};
});
const result = {
  url: page.url(), delivery, cases,
  runtime: JSON.parse(fs.readFileSync(path.join(root, '.runtime/patched-build.json'), 'utf8')),
  opentuiBuild: JSON.parse(fs.readFileSync(path.join(root, '.runtime/opentui-wasm-build.json'), 'utf8')),
  layout: JSON.parse(fs.readFileSync(path.join(root, '.runtime/ffi-layout-report.json'), 'utf8')),
  ffiPass: cases.contract.code === 0 && cases.contract.output.includes('FFI_CONTRACT_PASS'),
  opentuiGate: 'Delivered; awaiting visible renderer acceptance',
};
await page.evaluate(r => window.ffiQualification = r, result);
fs.writeFileSync(path.join(root, '../doc/logs/vivari/wire-browser.json'), JSON.stringify(result, null, 2) + '\n');
if (!result.ffiPass) throw Error(JSON.stringify(cases.contract));
if (cases.loopback.code!==0 || !cases.loopback.output.includes('LOOPBACK_FETCH_PASS')) throw Error(JSON.stringify(cases.loopback));
if (cases.rejection.some(r=>r.code!==0 || !r.output.includes('WIRE_REJECTION_PASS'))) throw Error(JSON.stringify(cases.rejection));
return {ffiPass: result.ffiPass, opentuiGate: result.opentuiGate, cases};

if (page.url() !== 'http://127.0.0.1:5205/') throw Error('Use isolated :5205');
const root = state.ffiRoot || [path.resolve('browser-container-poc/vivari'), path.resolve('vivari'), path.resolve('.')].find(p => fs.existsSync(path.join(p, 'scripts/ffi-browser.js')));
const source = fs.readFileSync(path.join(root, 'probes/runtime/install-opencode-launcher.cjs'), 'utf8');
return await page.evaluate(async source => {
  const p = await window.probe.vm.spawn('node', ['-e', source]);
  let output = '';
  const drain = (async () => { for await (const t of p.output) output += t; })();
  const code = await p.exit;
  await drain;
  if (code !== 0) throw Error(output);
  const hint=document.querySelector('#opencode-launch-hint') || document.createElement('p');
  hint.id='opencode-launch-hint';
  hint.textContent='OpenCode TUI installed: run opencode2 in the guest shell. This origin is the older provider-dialog demo; the matched model/edit demo is at http://127.0.0.1:5206/.';
  document.querySelector('#shell-tabs').before(hint);
  return {code, output};
}, source);

if(page.url() !== 'http://127.0.0.1:5202/') throw Error('Use isolated :5202');
const report = {started:new Date().toISOString(),phase:'running'};
const root = state.wasmTuiRoot || [path.resolve('browser-container-poc/vivari'),path.resolve('vivari'),path.resolve('.')].find(p=>fs.existsSync(path.join(p,'scripts/wasm-tui-browser.js')));
if(!root) throw Error('Set state.wasmTuiRoot');
const wait = fn => page.waitForFunction(fn,null,{timeout:15000});
try {
  report.delivery = await page.evaluate(()=>window.wasmTuiDelivery);
  await page.evaluate(()=>{const s=window.shells.sessions.get(1);s.screen.style.width='';s.screen.style.height=''});
  await wait(()=>window.shells.sessions.get(1).terminal.cols>100);
  report.independent = await page.evaluate(async()=>{
    const p=await window.probe.vm.spawn('node',['/wasm-tui/positional.cjs']);
    let output='';const drain=(async()=>{for await(const t of p.output)output+=t})();
    const code=await p.exit;await drain;return {code,output};
  });
  if(report.independent.code!==0 || !report.independent.output.includes('WASI_LIBC_PASS')) throw Error(JSON.stringify(report.independent));
  await page.locator('.xterm-helper-textarea').first().focus();
  await page.keyboard.type('node /wasm-tui/core.cjs');await page.keyboard.press('Enter');
  await wait(()=>window.shells.sessions.get(1).terminal.buffer.active.type==='alternate');
  await wait(()=>window.shells.sessions.get(1).terminal.buffer.active.getLine(0).translateToString(true).startsWith('Real OpenTUI WASM: '));
  report.firstFrame = await page.evaluate(()=>{const s=window.shells.sessions.get(1);return {cols:s.terminal.cols,rows:s.terminal.rows,text:s.terminal.buffer.active.getLine(0).translateToString(true).trimEnd()}});
  await page.keyboard.type('hello');
  await wait(()=>window.shells.sessions.get(1).terminal.buffer.active.getLine(0).translateToString(true).trimEnd()==='Real OpenTUI WASM: hello');
  await page.evaluate(()=>{const s=window.shells.sessions.get(1);s.screen.style.width='640px';s.screen.style.height='240px'});
  await wait(()=>window.shells.sessions.get(1).terminal.cols>67 && window.shells.sessions.get(1).terminal.cols<100);
  report.inputAndResize = await page.evaluate(()=>{const s=window.shells.sessions.get(1);return {cols:s.terminal.cols,rows:s.terminal.rows,text:s.terminal.buffer.active.getLine(0).translateToString(true).trimEnd()}});
  await page.screenshot({path:path.resolve(root,'../doc/logs/vivari/wasm-tui-frame.png')});
  await page.keyboard.type('q');
  await wait(()=>{const s=window.shells.sessions.get(1);return s.terminal.buffer.active.type==='normal' && s.transcript.includes('WASM_CORE_PASS') && s.transcript.endsWith('$\x1b[0m ')});
  report.tail=await page.evaluate(()=>window.shells.sessions.get(1).transcript.slice(-2500));
  const matches=[...report.tail.matchAll(/WASM_CORE_PASS (\{[^\n]+\})/g)];
  report.destroy=JSON.parse(matches.at(-1)[1]);
  if(report.destroy.value!=='Real OpenTUI WASM: hello'||report.destroy.cols!==report.inputAndResize.cols||report.destroy.rows!==report.inputAndResize.rows) throw Error('guest resize/text mismatch');
  report.phase='passed';
} catch(e) {report.phase='failed';report.error=String(e)}
await page.evaluate(r=>window.wasmTuiQualification=r,report);
fs.writeFileSync(path.resolve(root,'../doc/logs/vivari/wasm-tui-browser.json'),JSON.stringify(report,null,2));
return {phase:report.phase,error:report.error,independent:report.independent,firstFrame:report.firstFrame,inputAndResize:report.inputAndResize,destroy:report.destroy};

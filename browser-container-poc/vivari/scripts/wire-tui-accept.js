if (page.url() !== 'http://127.0.0.1:5204/') throw Error('Use isolated :5204');
const root = state.ffiRoot || [path.resolve('browser-container-poc/vivari'),path.resolve('vivari'),path.resolve('.')].find(p=>fs.existsSync(path.join(p,'scripts/ffi-browser.js')));
const result = {started:new Date().toISOString(), phase:'running', cycles:[]};
const wait = fn => page.waitForFunction(fn, null, {timeout:20000});
try {
  const offset = await page.evaluate(()=>window.shells.sessions.get(1).transcript.length);
  await page.evaluate(()=>{const s=window.shells.sessions.get(1);s.screen.style.width='';s.screen.style.height='';});
  await wait(()=>window.shells.sessions.get(1).terminal.cols>100);
  await page.locator('.xterm-helper-textarea').first().focus();
  await page.keyboard.type('node /ffi-probe/tui.cjs'); await page.keyboard.press('Enter');
  for (const cycle of [1,2]) {
    await page.waitForFunction(c => {
      const t = window.shells.sessions.get(1).terminal;
      return t.buffer.active.type === 'alternate' && t.buffer.active.getLine(0).translateToString(true).includes(`qualification cycle ${c}`);
    }, cycle, {timeout:20000});
    const first = await page.evaluate(()=>{const s=window.shells.sessions.get(1);return {cols:s.terminal.cols,rows:s.terminal.rows,text:s.terminal.buffer.active.getLine(0).translateToString(true)}});
    await page.keyboard.type('hello');
    await page.waitForFunction(c=>window.shells.sessions.get(1).terminal.buffer.active.getLine(0).translateToString(true).trimEnd() === `Real OpenTUI input hello cycle ${c}`, cycle, {timeout:15000});
    await page.evaluate(c=>{const s=window.shells.sessions.get(1);s.screen.style.width=c===1?'640px':'800px';s.screen.style.height=c===1?'240px':'300px';},cycle);
    await page.waitForFunction(c=>{const t=window.shells.sessions.get(1).terminal;return t.cols === (c===1?74:93);},cycle,{timeout:15000});
    // Wait for the guest resize debounce and native frame, not just the host grid.
    await page.waitForFunction(c=>{const t=window.shells.sessions.get(1).terminal;return t.buffer.active.getLine(0).translateToString(true).trimEnd() === `Real OpenTUI input hello cycle ${c}`;},cycle,{timeout:15000});
    const resized = await page.evaluate(()=>{const s=window.shells.sessions.get(1);return {cols:s.terminal.cols,rows:s.terminal.rows,text:s.terminal.buffer.active.getLine(0).translateToString(true)}});
    await page.waitForFunction(async ({cycle,cols,rows})=>{
      const bytes=await window.probe.vm.fs.readFile('/ffi-probe/tui-trace.jsonl');
      return new TextDecoder().decode(bytes).includes(`tui: resize ${cycle} ${cols}x${rows}`);
    },{cycle,...resized},{timeout:15000});
    await page.screenshot({path:path.resolve(root,`../doc/logs/vivari/wire-tui-cycle-${cycle}.png`)});
    result.cycles.push({cycle,first,resized});
    await page.keyboard.type('q');
  }
  await page.waitForFunction(off=>{const s=window.shells.sessions.get(1);return s.terminal.buffer.active.type==='normal' && s.transcript.slice(off).includes('TUI_LIFECYCLE_PASS') && s.transcript.endsWith('$\x1b[0m ');},offset,{timeout:15000});
  result.transcript = await page.evaluate(off=>window.shells.sessions.get(1).transcript.slice(off),offset);
  if (/tui: failed|panic:|aborting/.test(result.transcript)) throw Error('Guest failure in transcript');
  if (!result.transcript.includes('TUI_ABI_PASS')) throw Error('Missing ABI assertions');
  for (const {cycle,resized} of result.cycles) if (!result.transcript.includes(`tui: resize ${cycle} ${resized.cols}x${resized.rows}`)) throw Error('Guest resize acknowledgment missing');
  await page.keyboard.type('echo WIRE_SHELL_USABLE');await page.keyboard.press('Enter');
  await wait(()=>window.shells.sessions.get(1).transcript.includes('\nWIRE_SHELL_USABLE\n'));
  result.phase='passed';
} catch (error) {result.phase='failed';result.error=String(error);}
result.delivery = await page.evaluate(()=>window.ffiQualification);
await page.evaluate(r=>window.wireTuiQualification=r,result);
fs.writeFileSync(path.resolve(root,'../doc/logs/vivari/wire-tui-browser.json'),JSON.stringify(result,null,2));
return {phase:result.phase,error:result.error,cycles:result.cycles};

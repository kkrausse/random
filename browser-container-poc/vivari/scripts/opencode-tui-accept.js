if(page.url() !== 'http://127.0.0.1:5205/') throw Error('Use isolated :5205');
const root=state.ffiRoot || [path.resolve('browser-container-poc/vivari'),path.resolve('vivari'),path.resolve('.')].find(p=>fs.existsSync(path.join(p,'scripts/ffi-browser.js')));
const evidence={started:new Date().toISOString(),url:page.url(),phase:'running'};
const screen=()=>page.evaluate(()=>{const s=window.shells.sessions.get(1);return {cols:s.terminal.cols,rows:s.terminal.rows,lines:Array.from({length:s.terminal.rows},(_,i)=>s.terminal.buffer.active.getLine(i).translateToString(true).trimEnd())}});
try {
  await page.waitForFunction(()=>window.opencodeSource.serverOutput.includes('server listening'));
  await page.evaluate(()=>{const s=window.shells.sessions.get(1);s.screen.style.width='1584px';s.screen.style.height='310px';});
  await page.waitForFunction(()=>window.shells.sessions.get(1).terminal.cols===186);
  const offset=await page.evaluate(()=>window.shells.sessions.get(1).transcript.length);
  await page.locator('.xterm-helper-textarea').first().focus();
  await page.keyboard.type('bun /opencode-tui/cli/entry.cjs');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>{const t=window.shells.sessions.get(1).terminal;return t.buffer.active.type==='alternate'&&Array.from({length:t.rows},(_,i)=>t.buffer.active.getLine(i).translateToString(true)).some(l=>l.includes('Connect a provider'));},null,{timeout:20000});
  evidence.before=await screen();
  await page.keyboard.type('nemotron');
  await page.waitForFunction(()=>{const t=window.shells.sessions.get(1).terminal;return Array.from({length:t.rows},(_,i)=>t.buffer.active.getLine(i).translateToString(true)).some(l=>l.includes('nemotron'));});
  await page.evaluate(()=>{const s=window.shells.sessions.get(1);s.screen.style.width='1000px';s.screen.style.height='420px';});
  await page.waitForFunction(()=>window.shells.sessions.get(1).terminal.cols===116);
  await page.waitForFunction(()=>{const t=window.shells.sessions.get(1).terminal;return Array.from({length:t.rows},(_,i)=>t.buffer.active.getLine(i).translateToString(true)).some(l=>l.includes('Connect a provider')&&l.indexOf('Connect a provider')<50);});
  evidence.after=await screen();
  await page.screenshot({path:path.resolve(root,'../doc/logs/vivari/wire-opencode-provider.png')});
  await page.keyboard.press('Control+c');
  await page.waitForFunction(off=>{const s=window.shells.sessions.get(1);return s.terminal.buffer.active.type==='normal' && s.transcript.slice(off).endsWith('$\x1b[0m ');},offset,{timeout:15000});
  evidence.transcript=await page.evaluate(off=>window.shells.sessions.get(1).transcript.slice(off),offset);
  evidence.destroy={returnedToShell:true};
  evidence.phase='provider-dialog-pass-model-blocked';
} catch(error) {evidence.phase='failed';evidence.error=String(error);}
evidence.server=await page.evaluate(()=>({output:window.opencodeSource.serverOutput,code:window.opencodeSource.serverCode}));
fs.writeFileSync(path.resolve(root,'../doc/logs/vivari/wire-opencode-tui.json'),JSON.stringify(evidence,null,2));
return {phase:evidence.phase,error:evidence.error,before:evidence.before,after:evidence.after,destroy:evidence.destroy};

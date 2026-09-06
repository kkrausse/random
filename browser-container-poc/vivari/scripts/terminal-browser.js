// Own isolated :5197 runtime, booted with Shell 1/2. No reload or OPFS reset.
if (page.url() !== 'http://127.0.0.1:5197/') throw Error('Use isolated terminal origin :5197');
const report = { phase: 'running', results: [] };
const wait = async (predicate, why) => {
  await page.waitForFunction(predicate, null, { timeout: 15000 }).catch(e => { throw Error(why + ': ' + e.message); });
};
try {
  report.initial = await page.evaluate(async () => {
    const b = window.shells.sessions.get(2);
    await window.probe.vm.fs.writeFile('/workspace/terminal-reader.cjs', `
      const size=()=>process.stdout.columns+'x'+process.stdout.rows;
      console.log('GUEST_START:'+size());
      process.stdout.on('resize',()=>console.log('GUEST_RESIZE:'+size()+':'+process.stderr.columns+'x'+process.stderr.rows));
      process.on('SIGWINCH',()=>console.log('GUEST_WINCH:'+size()));
      process.on('SIGINT',()=>{require('fs').writeFileSync('terminal-caught','caught');console.log('GUEST_CAUGHT_INT');});
      process.stdin.on('end',()=>console.log('BAD_EOF'));
      let input='';
      process.stdin.on('data',d=>{input+=d.toString();while(input.includes('\\n')){const end=input.indexOf('\\n');const line=input.slice(0,end);input=input.slice(end+1);console.log('GUEST_INPUT:'+line);if(line==='finish')process.exit(0);}});
    `);
    b.send('node terminal-reader.cjs &\r');
    return { cols: b.terminal.cols, rows: b.terminal.rows };
  });
  await wait(() => window.shells.sessions.get(2).transcript.includes('GUEST_START:'), 'guest started');
  const actual = await page.evaluate(() => window.shells.sessions.get(2).transcript.match(/GUEST_START:(\d+x\d+)/)?.[1]);
  if (actual !== `${report.initial.cols}x${report.initial.rows}`) throw Error('guest spawn size mismatch: ' + actual);
  // Real element resize invokes ResizeObserver -> fit -> SDK -> kernel -> worker.
  report.resized = await page.evaluate(() => {
    const screen = document.querySelector('[data-shell="2"] .shell-screen');
    screen.style.width = '580px'; screen.style.height = '210px';
    return { width: 580, height: 210 };
  });
  await wait(() => {
    const b = window.shells.sessions.get(2), size = b.terminal.cols+'x'+b.terminal.rows;
    return b.transcript.includes('GUEST_RESIZE:'+size+':'+size) && b.transcript.includes('GUEST_WINCH:'+size);
  }, 'guest resize notifications match xterm');
  report.geometry = await page.evaluate(() => {
    const b=window.shells.sessions.get(2); return {cols:b.terminal.cols, rows:b.terminal.rows, output:b.transcript};
  });
  report.results.push('spawn geometry; actual element resize through fit/SDK/kernel; stdout/stderr updated; SIGWINCH');
  await page.evaluate(() => window.shells.sessions.get(2).send('echo background-keeps-prompt\r'));
  await wait(() => window.shells.sessions.get(2).transcript.includes('\nbackground-keeps-prompt\n'), 'background input isolation');
  if (await page.evaluate(() => /GUEST_INPUT:|BAD_EOF/.test(window.shells.sessions.get(2).transcript))) throw Error('background input stolen or EOF');
  await page.evaluate(() => window.shells.sessions.get(2).send('fg %1\r'));
  await wait(() => window.shells.sessions.get(2).transcript.endsWith('node terminal-reader.cjs\n'), 'fg selected job');
  await page.locator('[data-shell="2"] .xterm-helper-textarea').focus();
  await page.keyboard.type('hello'); await page.keyboard.press('Enter');
  await wait(() => window.shells.sessions.get(2).transcript.includes('GUEST_INPUT:hello'), 'keyboard reaches foreground reader');
  await page.keyboard.press('Control+c');
  await wait(() => window.shells.sessions.get(2).transcript.includes('GUEST_CAUGHT_INT'), 'catchable keyboard Ctrl+C');
  await page.keyboard.type('finish'); await page.keyboard.press('Enter');
  await wait(() => { const t=window.shells.sessions.get(2).transcript; return t.includes('GUEST_INPUT:finish') && t.endsWith('$\x1b[0m '); }, 'child continues then exits; prompt restored');
  report.results.push('background stdin held open and isolated; fg transfers stdin; real keyboard input/Ctrl+C; guest handler survives; later input exits to prompt');
  report.final = await page.evaluate(async () => ({
    caught: String(await window.probe.vm.fs.readFile('/workspace/terminal-caught', 'utf-8')),
    shells:[...window.shells.sessions.values()].map(s=>({id:s.id,state:s.state,cols:s.terminal.cols,rows:s.terminal.rows,tail:s.transcript.slice(-3500)})),
  }));
  report.phase = 'complete';
} catch(e) { report.phase = 'failed'; report.error = String(e); }
await page.evaluate(report => window.terminalQualification = report, report);
const evidenceDir = path.resolve(process.cwd().endsWith('/vivari') ? '../doc/logs/vivari' : process.cwd().endsWith('/browser-container-poc') ? 'doc/logs/vivari' : 'browser-container-poc/doc/logs/vivari');
fs.writeFileSync(path.join(evidenceDir, 'terminal-browser.json'), JSON.stringify(report,null,2));
return report;

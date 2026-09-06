// Browser Control runner. Dedicated http://127.0.0.1:5196 only; boot/install,
// open Shell 1 + Shell 2, and run `bun run dev &` in Shell 1 first.
// Leaves Vite and both shells alive for visual inspection; does not reset OPFS.
if (!['http://127.0.0.1:5196/', 'http://127.0.0.1:5197/'].includes(page.url())) throw Error('Use an owned isolated shell origin :5196 or :5197');
return await page.evaluate(async () => {
  const report = window.shellQualification = { phase: 'running', results: [], started: new Date().toISOString() };
  const a = window.shells.sessions.get(1), b = window.shells.sessions.get(2);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const wait = async (fn, label) => {
    const end = performance.now() + 15000;
    while (!fn() && performance.now() < end) await sleep(20);
    if (!fn()) throw Error(label);
  };
  const cmd = async (shell, line, expected) => {
    const before = shell.transcript;
    shell.send(line + '\r');
    await wait(() => shell.transcript !== before && shell.transcript.includes(expected) && shell.transcript.endsWith('$\x1b[0m '), line);
  };
  try {
    if (!a || !b) throw Error('Open two shells first');
    const frame = document.querySelector('#preview');
    await wait(() => frame.contentDocument?.querySelector('h1')?.textContent === 'Ready for an agent edit', 'Vite preview heading');
    const doc = frame.contentDocument;
    await cmd(a, 'jobs', '] Running');
    await cmd(b, 'pwd', '/workspace\n');
    await cmd(b, 'ls', 'src');
    await cmd(b, 'node --version', 'v');
    await cmd(b, 'echo shell-shared > shell-shared.txt', '$\x1b[0m ');
    await cmd(a, 'cat shell-shared.txt', '\nshell-shared\n');
    report.results.push('Vite background job + two shells + shared file');
    // The EDIT is performed by a real Node child reached through shell stdin.
    const edit = `node -e "const fs=require('fs');const p='src/WelcomeCard.tsx';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('Ready for an agent edit','Shell HMR verified'))"`;
    await cmd(b, edit, '$\x1b[0m ');
    await wait(() => doc.querySelector('h1')?.textContent === 'Shell HMR verified', 'HMR edit');
    if (frame.contentDocument !== doc) throw Error('Preview reloaded instead of HMR');
    report.hmr = { heading: doc.querySelector('h1').textContent, sameDocument: true, preview: frame.src };
    await sleep(200);
    await cmd(b, edit.replace("replace('Ready for an agent edit','Shell HMR verified')", "replace('Shell HMR verified','Ready for an agent edit')"), '$\x1b[0m ');
    await wait(() => doc.querySelector('h1')?.textContent === 'Ready for an agent edit', 'HMR restore');
    report.results.push('guest shell edit + HMR + restoration, identical iframe Document');
    await cmd(b, 'echo café', '\ncafé\n');
    b.terminal.paste('echo paste-one\necho paste-two\n');
    await wait(() => b.transcript.includes('\npaste-two\n') && b.transcript.endsWith('$\x1b[0m '), 'multiline paste');
    await cmd(b, `node -e "for(let i=0;i<1000;i++)console.log(String.fromCharCode(27)+'[32mLINE-'+i+String.fromCharCode(27)+'[0m')"`, 'LINE-999');
    report.results.push('Unicode BMP / multiline input / 1000 ANSI output lines');
    await window.probe.vm.fs.writeFile('/workspace/shell-tick.cjs', "const fs=require('fs');console.log('TICK_READY');fs.appendFileSync('shell-ticks','x');setInterval(()=>fs.appendFileSync('shell-ticks','x'),30)");
    b.send('node shell-tick.cjs\r');
    await wait(() => b.transcript.includes('TICK_READY'), 'foreground timer');
    b.send('\x03'); await wait(() => b.transcript.endsWith('$\x1b[0m '), 'interrupt prompt');
    const bytes = await window.probe.vm.fs.readFile('/workspace/shell-ticks');
    await sleep(150);
    if (String(await window.probe.vm.fs.readFile('/workspace/shell-ticks')) !== String(bytes)) throw Error('child still writes after interrupt');
    await cmd(b, 'echo after-interrupt', '\nafter-interrupt\n');
    report.results.push('foreground Ctrl+C / child stops writing / prompt usable');
    b.stop(); await wait(() => b.state.startsWith('exited'), 'second shell stopped');
    if (a.state !== 'running') throw Error('stopping sibling stopped Vite shell');
    const response = await fetch(frame.src);
    if (!response.ok) throw Error('Vite did not survive sibling stop');
    await b.start(window.probe.vm);
    await wait(() => b.state === 'running', 'restart');
    // Wait for new prompt before sending; the old transcript is retained.
    await sleep(300);
    await cmd(b, 'echo restarted', '\nrestarted\n');
    report.results.push('stop sibling / Vite HTTP survives / restart');
    report.sessions = [a,b].map(s => ({id:s.id,state:s.state,tail:s.transcript.slice(-2000),cols:s.terminal.cols,rows:s.terminal.rows}));
    report.phase = 'complete';
  } catch (e) { report.phase = 'failed'; report.error = String(e); }
  return report;
});

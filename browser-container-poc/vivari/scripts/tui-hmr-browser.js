// Independent shell/Vite control, explicitly NOT a model or OpenCode TUI edit.
if (page.url() !== 'http://127.0.0.1:5198/') throw Error('Use the owned :5198 TUI origin');
return await page.evaluate(async () => {
  const report = window.tuiHmrControl = { actor: 'guest Node through Shell 2; no model', phase: 'running' };
  const vm = window.probe.vm;
  const shell = window.shells.sessions.get(2);
  const frame = document.querySelector('#preview');
  const doc = frame.contentDocument;
  const file = '/workspace/src/WelcomeCard.tsx';
  const read = async () => new TextDecoder().decode(await vm.fs.readFile(file));
  const original = await read();
  const changed = original.replace('Ready for an agent edit', 'TUI audit shell control');
  if (original === changed || !shell || doc?.querySelector('h1')?.textContent !== 'Ready for an agent edit') throw Error('Expected running fixture and Shell 2');
  const wait = async (fn, label) => {
    const end = performance.now() + 15000;
    while (!fn() && performance.now() < end) await new Promise(r => setTimeout(r, 30));
    if (!fn()) throw Error(label);
  };
  const edit = (from, to) => shell.send(`node -e "const fs=require('fs');const p='src/WelcomeCard.tsx';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('${from}','${to}'))"\r`);
  try {
    edit('Ready for an agent edit', 'TUI audit shell control');
    await wait(() => doc.querySelector('h1')?.textContent === 'TUI audit shell control', 'HMR heading');
    report.before = original;
    report.after = await read();
    report.fileDiffVerified = report.after === changed;
    report.sameDocument = frame.contentDocument === doc;
    if (!report.fileDiffVerified || !report.sameDocument) throw Error('Independent diff/document assertion');
    report.preview = frame.src;
    report.phase = 'passed';
  } catch (error) { report.phase = 'failed'; report.error = String(error); }
  finally {
    await wait(() => shell.transcript.endsWith('$\x1b[0m '), 'Shell idle before restore');
    await new Promise(r => setTimeout(r, 200));
    edit('TUI audit shell control', 'Ready for an agent edit');
    await wait(() => doc.querySelector('h1')?.textContent === 'Ready for an agent edit' && shell.transcript.endsWith('$\x1b[0m '), 'HMR restore');
    report.restored = await read() === original && frame.contentDocument === doc;
    if (!report.restored) throw Error('Restore assertion');
  }
  return report;
});

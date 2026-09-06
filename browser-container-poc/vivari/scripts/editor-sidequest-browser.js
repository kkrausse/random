// Browser Control CLI --file. Own :5201, booted; Shell 1 idle, Shell 2 serving Vite.
if (page.url() !== 'http://127.0.0.1:5201/') throw Error('Use isolated editor origin :5201');
const root = state.editorSidequestRoot || path.resolve(process.cwd().endsWith('/vivari') ? '..' : process.cwd().endsWith('/browser-container-poc') ? '.' : 'browser-container-poc');
const evidence = path.join(root, 'doc/logs/vivari');
const bundle = fs.readFileSync(path.join(root, 'vivari/.runtime/editor-sidequest/editor-sidequest.cjs'), 'utf8');
const report = { phase: 'running', checks: [], metadata: JSON.parse(fs.readFileSync(path.join(root, 'vivari/.runtime/editor-sidequest/metadata.json'), 'utf8')) };
const wait = (fn) => page.waitForFunction(fn, null, { timeout: 15000 });
const type = (text) => page.keyboard.type(text);
const enter = () => page.keyboard.press('Enter');
const ex = async text => { await type(text); await enter(); };
try {
  await page.evaluate(async bundle => {
    const shell = window.shells.sessions.get(1);
    if (shell.terminal.buffer.active.type !== 'normal' || !shell.transcript.endsWith('$\x1b[0m ')) throw Error('Shell 1 must be idle');
    await window.probe.vm.fs.writeFile('/workspace/editor-sidequest.cjs', bundle);
    await window.probe.vm.fs.writeFile('/workspace/editor-sidequest.txt', 'before editor\n');
  }, bundle);
  await page.getByRole('button', { name: 'Shell 1', exact: true }).click();
  await page.locator('[data-shell="1"] .xterm-helper-textarea').focus();
  await ex('node editor-sidequest.cjs editor-sidequest.txt');
  await wait(() => window.shells.sessions.get(1).terminal.buffer.active.type === 'alternate');
  await type('iREAL GUEST '); await page.keyboard.press('Escape');
  await ex(':w');
  await wait(async () => String(await window.probe.vm.fs.readFile('/workspace/editor-sidequest.txt', 'utf-8')) === 'REAL GUEST before editor\n');
  await page.screenshot({ path: path.join(evidence, 'editor-sidequest-open-save.png') });
  await ex(':q');
  await wait(() => window.shells.sessions.get(1).terminal.buffer.active.type === 'normal' && window.shells.sessions.get(1).transcript.endsWith('$\x1b[0m '));
  await page.evaluate(() => window.editorSidequestCatOffset = window.shells.sessions.get(1).transcript.length);
  await ex('cat editor-sidequest.txt');
  await wait(() => { const text = window.shells.sessions.get(1).transcript.slice(window.editorSidequestCatOffset); return text.includes('cat editor-sidequest.txt\nREAL GUEST before editor\n') && text.endsWith('$\x1b[0m '); });
  report.checks.push('keyboard open/insert/Escape/:w/:q; guest readback; alternate screen restored; shell cat');
  await page.evaluate(async () => {
    window.editorSidequestOriginal = String(await window.probe.vm.fs.readFile('/workspace/src/WelcomeCard.tsx', 'utf-8'));
    window.editorSidequestDocument = document.querySelector('iframe').contentDocument;
    if (!window.editorSidequestDocument.querySelector('h1')?.textContent?.includes('Ready for an agent edit')) throw Error('Expected original preview');
  });
  await ex('node editor-sidequest.cjs src/WelcomeCard.tsx');
  await wait(() => window.shells.sessions.get(1).terminal.buffer.active.type === 'alternate');
  await ex('/Ready');
  await type('iEditor verified: '); await page.keyboard.press('Escape');
  await ex(':w');
  await wait(() => document.querySelector('iframe').contentDocument.querySelector('h1')?.textContent === 'Editor verified: Ready for an agent edit');
  report.hmr = await page.evaluate(async () => ({
    sameDocument: window.editorSidequestDocument === document.querySelector('iframe').contentDocument,
    text: document.querySelector('iframe').contentDocument.querySelector('h1').textContent,
    file: String(await window.probe.vm.fs.readFile('/workspace/src/WelcomeCard.tsx', 'utf-8')),
  }));
  if (!report.hmr.sameDocument) throw Error('HMR replaced document');
  await page.screenshot({ path: path.join(evidence, 'editor-sidequest-hmr.png') });
  await type('u'); await ex(':w');
  await wait(() => document.querySelector('iframe').contentDocument.querySelector('h1')?.textContent === 'Ready for an agent edit');
  report.restored = await page.evaluate(async () => String(await window.probe.vm.fs.readFile('/workspace/src/WelcomeCard.tsx', 'utf-8')) === window.editorSidequestOriginal && window.editorSidequestDocument === document.querySelector('iframe').contentDocument);
  if (!report.restored) throw Error('Undo did not restore original bytes and document');
  await ex(':q');
  await wait(() => window.shells.sessions.get(1).terminal.buffer.active.type === 'normal' && window.shells.sessions.get(1).transcript.endsWith('$\x1b[0m '));
  report.checks.push('search /Ready, insert, :w triggers real Vite HMR; u/:w restores exact original bytes; same iframe Document both times; :q');
  report.phase = 'complete';
} catch (error) { report.phase = 'failed'; report.error = String(error); }
report.shells = await page.evaluate(() => [...window.shells.sessions.values()].map(s => ({ id: s.id, state: s.state, tail: s.transcript.slice(-2500) })));
await page.evaluate(report => window.editorSidequestReport = report, report);
fs.writeFileSync(path.join(evidence, 'editor-sidequest-browser.json'), JSON.stringify(report, null, 2));
return report;

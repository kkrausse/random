// Run through Browser Control CLI on the selected isolated demo tab.
if (!/^http:\/\/127\.0\.0\.1:521[67]\/$/.test(page.url())) throw Error('Select the isolated demo');
const root = [path.resolve('browser-container-poc/terminal-agent-demo'), path.resolve('terminal-agent-demo'), path.resolve('.')].find(p => fs.existsSync(path.join(p, 'accept.js')));
const screen = () => page.evaluate(() => {const t=window.demo.terminal;return Array.from({length:t.rows}, (_,i)=>t.buffer.active.getLine(t.buffer.active.viewportY+i)?.translateToString(true)).join('\n')});
for (let boot = 0; boot < 2; boot++) {
  await page.reload();
  await page.waitForFunction(() => window.demo?.phase.startsWith('Shell ready') || window.demo?.phase.startsWith('Failed'), null, {timeout:180000});
  if (!(await page.evaluate(() => window.demo.phase)).startsWith('Shell ready')) throw Error(await page.evaluate(() => window.demo.logs));
  await page.waitForFunction(() => document.querySelector('#preview').contentDocument?.querySelector('h1')?.textContent === 'Ready for an agent edit', null, {timeout:60000});
  await page.getByRole('button', {name:'Launch OpenCode', exact:true}).click();
  await page.waitForFunction(() => window.demo.terminal.buffer.active.type === 'alternate' && Array.from({length:window.demo.terminal.rows}, (_,i) => window.demo.terminal.buffer.active.getLine(i)?.translateToString(true)).some(s => s?.includes('Muse Spark')), null, {timeout:60000});
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Control+c');
  await page.waitForFunction(() => window.demo.phase.startsWith('Shell ready') && window.demo.terminal.buffer.active.type === 'normal', null, {timeout:30000});
}
await page.getByRole('button', {name:'Stop shell', exact:true}).click();
await page.waitForFunction(() => window.demo.phase.startsWith('Shell exited'));
await page.getByRole('button', {name:'Start shell', exact:true}).click();
await page.waitForFunction(() => window.demo.phase.startsWith('Shell ready'));
const report = await page.evaluate(() => window.demo.diagnostics());
if (!report.processes.server || !report.processes.vite || !report.processes.shell || !report.hashes['manifest.json']) throw Error('Incomplete diagnostics or stopped services');
fs.mkdirSync(path.join(root, 'evidence'), {recursive:true});
fs.writeFileSync(path.join(root, 'evidence/shell-v2.json'), JSON.stringify({ ...report, screen:await screen(), reload:true, launcher:true, ctrlC:true, shellRecovery:true }, null, 2));
return {phase:report.phase, processes:report.processes, preview:report.preview, reload:true, launcher:true, ctrlC:true, shellRecovery:true};

import { Vivari } from '@vivari/core';
import { Terminal } from '../vivari/node_modules/@xterm/xterm';
import { FitAddon } from '../vivari/node_modules/@xterm/addon-fit';
const terminal = new Terminal({ fontSize: 14, convertEol: true });
const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(document.querySelector('#terminal')!);
const start = document.querySelector<HTMLButtonElement>('#start')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
let vm: any, server: any, tui: any, writer: any, installed = false;
let logs = '', phase = 'ready', serverOutput = '';
function log(s: string) { logs = (logs + s + '\n').slice(-1000000); document.querySelector('#logs')!.textContent = logs; }
function status(s: string) { phase = s; document.querySelector('#status')!.textContent = s; log(new Date().toISOString() + ' ' + s); }
new ResizeObserver(() => { fit.fit(); tui?.resize({ cols: terminal.cols, rows: terminal.rows }); }).observe(document.querySelector('#terminal')!);
terminal.onData(data => { writer?.write(data).catch((e: unknown) => log(String(e))); });
terminal.onWriteParsed(() => {
  if (phase.startsWith('TUI provider dialog')) return;
  if (terminal.buffer.active.type === 'alternate' && Array.from({ length: terminal.rows }, (_, i) => terminal.buffer.active.getLine(i)?.translateToString(true)).some(line => line?.includes('Connect a provider'))) status('TUI provider dialog rendered. Keyboard is ready; model/backend workflow remains unqualified.');
});
async function run(source: string) {
  const p = await vm.spawn('node', ['-e', source]);
  let output = ''; const drain = (async () => { for await (const text of p.output) output += text; })();
  const timer = setTimeout(() => p.kill(), 30000);
  try { const code = await p.exit; await drain; if (code) throw Error(output || `Guest command exit ${code}`); return output; } finally { clearTimeout(timer); }
}
start.onclick = async () => {
  start.disabled = true;
  try {
    if (tui && writer) { status('Launching OpenCode in the existing guest shell…'); await writer.write('bun /opencode-tui/cli/entry.cjs\r'); terminal.focus(); return; }
    if (!crossOriginIsolated) throw Error('Isolation headers missing. Use the provided serve.ts URL in Chrome.');
    if (!vm) { status('Booting browser runtime…'); vm = await Vivari.boot(); vm.on('error', (e: any) => log('Kernel: ' + e.message)); }
    if (!installed) {
      status('Mounting workspace (existing files preserved)…');
      if (!await vm.fs.exists('/workspace/package.json')) {
        const files = await (await fetch('/fixture.json')).json();
        for (const [name, text] of Object.entries(files)) { const p = '/workspace/' + name; await vm.fs.mkdir(p.slice(0, p.lastIndexOf('/')), { recursive: true }); await vm.fs.writeFile(p, text); }
      }
      const manifest = await (await fetch('/manifest.json')).json();
      log('OpenCode revision: ' + manifest.revision);
      await vm.fs.mkdir('/demo-parts', { recursive: true });
      for (const a of manifest.assets) {
        status('Installing and verifying ' + a.destination + '…');
        const bytes = new Uint8Array(await (await fetch('/guest/' + a.file)).arrayBuffer());
        for (let off = 0, part = 0; off < bytes.length; off += 262144, part++) await vm.fs.writeFile('/demo-parts/' + part, bytes.slice(off, off + 262144));
        const output = await run(`const fs=require('fs');const p=${JSON.stringify(a.destination)};fs.mkdirSync(require('path').dirname(p),{recursive:true});const fd=fs.openSync(p,'w');for(let i=0;i<${Math.ceil(bytes.length / 262144)};i++){const part='/demo-parts/'+i;fs.writeSync(fd,fs.readFileSync(part));fs.unlinkSync(part)}fs.closeSync(fd);console.log(require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'));`);
        if (!output.includes(a.sha256)) throw Error('Guest SHA-256 mismatch: ' + a.destination);
        log('Verified ' + a.sha256);
      }
      installed = true;
    }
    if (!server) {
      status('Starting real guest OpenCode server on guest port 4096…'); serverOutput = '';
      server = await vm.spawn('node', ['/opencode-tui/cli/entry.cjs', 'serve', '--port', '4096', '--register'], { cwd: '/workspace' });
      const owned = server;
      void (async () => { for await (const t of owned.output) { serverOutput += t; log('[server] ' + t); } })();
      void owned.exit.then((code: number) => { server = undefined; log('Server exited ' + code); });
      const deadline = Date.now() + 60000;
      while (!serverOutput.includes('server listening')) { if (!server || Date.now() > deadline) throw Error('Guest server did not become ready. Inspect server diagnostics, then retry Start.'); await new Promise(r => setTimeout(r, 100)); }
    }
    status('Launching OpenCode…'); terminal.reset(); fit.fit();
    // The interactive shell owns Ctrl+C signal forwarding to its foreground child.
    tui = await vm.spawn('sh', [], { cwd: '/workspace', env: { TERM: 'xterm-256color' }, terminal: { cols: terminal.cols, rows: terminal.rows } });
    writer = tui.input.getWriter(); stop.disabled = false; terminal.focus();
    const owned = tui;
    let launched = false;
    void (async () => { for await (const t of owned.output) {
      terminal.write(t);
      if (t.includes('$\x1b[0m ')) {
        if (!launched) { launched = true; await writer.write('bun /opencode-tui/cli/entry.cjs\r'); }
        else { status('TUI returned to guest shell. Click Start OpenCode to launch again, or type a guest command.'); start.disabled = false; }
      }
    } })().catch(e => log(String(e)));
    status('TUI process running. Waiting for OpenCode screen; provider/model access is not yet qualified.');
    void owned.exit.then((code: number) => { writer?.releaseLock(); writer = undefined; tui = undefined; stop.disabled = true; start.disabled = false; status(`TUI exited ${code}. Click Start OpenCode to launch again.`); });
  } catch (e) { status(`Failed during ${phase}: ${String(e)}. Download diagnostics; retry Start or reload this tab to reboot (files preserved).`); start.disabled = false; }
};
stop.onclick = () => tui?.kill();
document.querySelector<HTMLButtonElement>('#download')!.onclick = async () => {
  const hashes = await (await fetch('/hashes.json')).json();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ url: location.href, phase, logs, hashes }, null, 2)], { type: 'application/json' })); a.download = 'opencode-demo-diagnostics.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
Object.assign(window, { demo: { terminal, get vm() { return vm; }, get phase() { return phase; }, get logs() { return logs; } } });

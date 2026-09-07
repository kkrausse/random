import { Vivari } from '@vivari/core';
import { Terminal } from '../vivari/node_modules/@xterm/xterm';
import { FitAddon } from '../vivari/node_modules/@xterm/addon-fit';
const terminal = new Terminal({ fontSize: 14, convertEol: true });
const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(document.querySelector('#terminal')!);
const start = document.querySelector<HTMLButtonElement>('#start')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const launch = document.querySelector<HTMLButtonElement>('#launch')!;
// Guest loopback addresses reach guest services; this alias reaches the host proxy.
const guestEnv = { TERM: 'xterm-256color', XDG_DATA_HOME:'/home/user/vivari-v2/data', XDG_CONFIG_HOME:'/home/user/vivari-v2/config', XDG_CACHE_HOME:'/home/user/vivari-v2/cache', XDG_STATE_HOME:'/home/user/vivari-v2/state', OPENCODE_MODELS_PATH:'/opencode-v2/models.json', OPENCODE_DISABLE_MODELS_FETCH:'1', OPENCODE_DISABLE_FFF:'1', OPENCODE_DISABLE_FILEWATCHER:'1', OTUI_TREE_SITTER_WORKER_PATH:'/opencode-v2/parser/entry.cjs' };
const preview = document.querySelector<HTMLIFrameElement>('#preview')!;
let vite: any;
let vm: any, server: any, tui: any, writer: any, installed = false;
let logs = '', phase = 'ready', serverOutput = '', shellOutput = '';
function log(s: string) { logs = (logs + s + '\n').slice(-1000000); document.querySelector('#logs')!.textContent = logs; }
function status(s: string) { phase = s; document.querySelector('#status')!.textContent = s; log(new Date().toISOString() + ' ' + s); }
window.addEventListener('error', e => log('[page error] ' + (e.error?.stack || e.message)));
window.addEventListener('unhandledrejection', e => log('[unhandled rejection] ' + String(e.reason?.stack || e.reason)));
new ResizeObserver(() => { fit.fit(); tui?.resize({ cols: terminal.cols, rows: terminal.rows }); }).observe(document.querySelector('#terminal')!);
terminal.onData(data => { writer?.write(data).catch((e: unknown) => log(String(e))); });
async function run(source: string) {
  const p = await vm.spawn('node', ['-e', source]);
  let output = ''; const drain = (async () => { for await (const text of p.output) output += text; })();
  const timer = setTimeout(() => p.kill(), 30000);
  try { const code = await p.exit; await drain; if (code) throw Error(output || `Guest command exit ${code}`); return output; } finally { clearTimeout(timer); }
}
start.onclick = async () => {
  start.disabled = true;
  try {
    if (tui && writer) { terminal.focus(); return; }
    if (!crossOriginIsolated) throw Error('Isolation headers missing. Use the provided serve.ts URL in Chrome.');
    if (!vm) {
      status('Booting browser runtime…'); vm = await Vivari.boot(); vm.on('error', (e: any) => log('Kernel: ' + e.message));
      vm.bridge.on('log', (event: any) => log('[kernel] ' + event.line));
      for (const type of ['vv-ws', 'vv-sse']) vm.bridge.on(type, (event: any) => preview.contentWindow?.postMessage({ ...event.msg, type, dir: 'in' }, location.origin));
      vm.on('server-ready', (port: number, url: string) => { if (port === 5173) preview.src = url; });
    }
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
        const existing = await run(`const fs=require('fs');const p=${JSON.stringify(a.destination)};if(fs.existsSync(p))console.log(require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'));`);
        if (existing.trim() === a.sha256) continue;
        status('Installing and verifying ' + a.destination + '…');
        const bytes = new Uint8Array(await (await fetch('/guest/' + a.file)).arrayBuffer());
        for (let off = 0, part = 0; off < bytes.length; off += 262144, part++) await vm.fs.writeFile('/demo-parts/' + part, bytes.slice(off, off + 262144));
        const output = await run(`const fs=require('fs');const p=${JSON.stringify(a.destination)};fs.mkdirSync(require('path').dirname(p),{recursive:true});const fd=fs.openSync(p,'w');for(let i=0;i<${Math.ceil(bytes.length / 262144)};i++){const part='/demo-parts/'+i;fs.writeSync(fd,fs.readFileSync(part));fs.unlinkSync(part)}fs.closeSync(fd);console.log(require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'));`);
        if (!output.includes(a.sha256)) throw Error('Guest SHA-256 mismatch: ' + a.destination);
        log('Verified ' + a.sha256);
      }
      const wrapper = `const child=require('child_process').spawn('bun',['/opencode-v2/cli/entry.cjs',...process.argv.slice(2)],{stdio:['pipe','inherit','inherit'],env:{...process.env,...${JSON.stringify(guestEnv)}}});process.stdin.on('data',chunk=>child.stdin.write(chunk));process.stdin.once('end',()=>child.stdin.end());process.on('SIGINT',()=>child.kill('SIGINT'));child.on('error',e=>{console.error(e.message);process.exitCode=1});child.on('exit',code=>{process.stdin.pause();process.exitCode=code??1});`;
      await vm.fs.writeFile('/opencode-v2/run.cjs', wrapper);
      await run(`process.env.VIVARI_OPENCODE_PROFILE='v2';\n${await (await fetch('/install-launcher.cjs')).text()}`);
      await run(`const fs=require('fs');const p='/home/user/vivari-v2/config/opencode/opencode.json';if(!fs.existsSync(p)){fs.mkdirSync(require('path').dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify({$schema:'https://opencode.ai/config.json',model:'opencode/muse-spark-1.3-contributor-free',snapshots:false,providers:{opencode:{settings:{baseURL:${JSON.stringify(`http://host.vivari.internal:${location.port}/api/model/opencode`)}}}},permissions:[{action:'read',resource:'*',effect:'allow'},{action:'edit',resource:'*',effect:'allow'}]}));}`);
      status('Installing workspace dependencies…');
      const install = await vm.spawn('bun', ['install', '--frozen-lockfile'], { cwd: '/workspace' });
      const drain = (async () => { for await (const t of install.output) log(t); })();
      const code = await install.exit; await drain;
      if (code !== 0) throw Error('Dependency installation failed: ' + code);
      installed = true;
    }
    if (!server) {
      status('Starting OpenCode service…'); serverOutput = '';
      server = await vm.spawn('node', ['/opencode-v2/run.cjs', 'serve', '--service', '--port', '4106'], { cwd: '/workspace', env: guestEnv });
      const owned = server;
      void (async () => { for await (const t of owned.output) { serverOutput = (serverOutput + t).slice(-1000000); log('[server] ' + t); } })().catch(e => log('[server output] ' + String(e)));
      void owned.exit.then((code: number) => { server = undefined; log('Server exited ' + code); });
      const deadline = Date.now() + 60000;
      while (!serverOutput.includes('server listening')) { if (!server || Date.now() > deadline) throw Error('Guest server did not become ready. Inspect server diagnostics, then retry Start.'); await new Promise(r => setTimeout(r, 100)); }
    }
    if (!vite) {
      status('Starting Vite preview…');
      vite = await vm.spawn('bun', ['run', 'dev'], { cwd: '/workspace' });
      const owned = vite;
      void (async () => { for await (const t of owned.output) log('[vite] ' + t); })().catch(e => log('[vite output] ' + String(e)));
      void owned.exit.then((code: number) => { vite = undefined; log('Vite exited ' + code); });
    }
    status('Opening guest shell…'); terminal.reset(); fit.fit();
    // The interactive shell owns Ctrl+C signal forwarding to its foreground child.
    tui = await vm.spawn('sh', [], { cwd: '/workspace', env: guestEnv, terminal: { cols: terminal.cols, rows: terminal.rows } });
    writer = tui.input.getWriter(); stop.disabled = false; terminal.focus();
    const owned = tui;
    let tail = '';
    void (async () => { for await (const t of owned.output) {
      shellOutput = (shellOutput + t).slice(-1000000);
      terminal.write(t);
      tail = (tail + t).slice(-200);
      if (tail.endsWith('$\x1b[0m ')) {
        status('Shell ready in /workspace. Type a command, or click Launch OpenCode.'); launch.disabled = false;
      }
    } })().catch(e => log(String(e)));
    status('Shell starting…');
    void owned.exit.then((code: number) => { writer?.releaseLock(); writer = undefined; tui = undefined; stop.disabled = true; launch.disabled = true; start.disabled = false; status(`Shell exited ${code}. Click Start shell to reopen it.`); });
  } catch (e) { status(`Failed during ${phase}: ${String(e)}. Download diagnostics; retry Start or reload this tab to reboot (files preserved).`); start.disabled = false; }
};
launch.onclick = async () => {
  if (!writer) return;
  launch.disabled = true;
   try { status('Launching OpenCode…'); await writer.write('opencode2\r'); terminal.focus(); }
  catch (e) { log(String(e)); launch.disabled = false; }
};
stop.onclick = () => tui?.kill();
async function diagnostics() {
  const hashes = await (await fetch('/hashes.json')).json();
  return { time: new Date().toISOString(), url: location.href, phase, logs, hashes, serverOutput, shellOutput, processes: { installed, server: !!server, shell: !!tui, vite: !!vite }, browser: { userAgent: navigator.userAgent, crossOriginIsolated, online: navigator.onLine }, terminal: { cols: terminal.cols, rows: terminal.rows, screen: Array.from({length:terminal.rows}, (_,i) => terminal.buffer.active.getLine(i)?.translateToString(true)).join('\n') }, preview: { url: preview.src, text: preview.contentDocument?.body?.innerText } };
}
document.querySelector<HTMLButtonElement>('#download')!.onclick = async () => {
  const report = await diagnostics();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); a.download = 'opencode-demo-diagnostics.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
Object.assign(window, { demo: { terminal, diagnostics, get vm() { return vm; }, get phase() { return phase; }, get logs() { return logs; } } });
start.click();

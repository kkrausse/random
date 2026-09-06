// Browser Control CLI only. Run after Boot on the owned isolated :5198 origin.
// No guest code executes in the page: it only delivers assets and spawns workers.
if (page.url() !== 'http://127.0.0.1:5198/') throw Error('Use the owned :5198 TUI origin');
await page.evaluate(() => {
  if (window.tuiQualification?.phase === 'running') throw Error('TUI qualification already running');
  const report = window.tuiQualification = { phase: 'running', started: new Date().toISOString(), cases: [], delivery: [] };
  const vm = window.probe.vm;
  const run = async (command, args, timeout = 20000) => {
    const result = { command, args, output: '', timedOut: false };
    const proc = await vm.spawn(command, args, { cwd: '/tui-probe', terminal: { cols: 100, rows: 30 } });
    const timer = setTimeout(() => { result.timedOut = true; proc.kill(); }, timeout);
    const drain = (async () => { for await (const text of proc.output) result.output = (result.output + text).slice(-32000); })();
    try { result.code = await proc.exit; await drain; } finally { clearTimeout(timer); }
    return result;
  };
  void (async () => {
    try {
      const response = await fetch('/.runtime/tui-package/receipt.json');
      if (!response.ok) throw Error(`Receipt HTTP ${response.status}`);
      report.receipt = await response.json();
      await vm.fs.mkdir('/tui-probe', { recursive: true });
      const cliPath = '/workspace/node_modules/@opencode-ai/cli';
      const cliBytes = await vm.fs.readFile(`${cliPath}/package.json`);
      report.cli = JSON.parse(new TextDecoder().decode(cliBytes));
      if (report.cli.version !== report.receipt.cli) throw Error('CLI pin mismatch');
      report.cases.push(await run('node', [`${cliPath}/postinstall.mjs`]));
      report.cases.push(await run('node', ['-e', "for(const name of ['node:ffi','bun:ffi']){try{require(name).dlopen('/tui-probe/libopentui.so',{});console.log(name,'dlopen returned')}catch(e){console.log(name,e.message)}}"]));
      for (const asset of report.receipt.assets) {
        const response = await fetch(`/.runtime/tui-package/${asset.file}`);
        if (!response.ok) throw Error(`Asset HTTP ${response.status}: ${asset.file}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
        if (bytes.length !== asset.bytes || hash !== asset.sha256) throw Error(`Delivery mismatch ${asset.file}`);
        let count = 0;
        for (let offset = 0; offset < bytes.length; offset += 262144) await vm.fs.writeFile(`/tui-probe/part-${count++}`, bytes.slice(offset, offset + 262144));
        await vm.fs.writeFile('/tui-probe/assemble.cjs', `const fs=require('fs');const dest=${JSON.stringify(asset.destination)};fs.mkdirSync(require('path').dirname(dest),{recursive:true});const fd=fs.openSync(dest,'w');try{for(let i=0;i<${count};i++){const p='/tui-probe/part-'+i;fs.writeSync(fd,fs.readFileSync(p));fs.unlinkSync(p)}}finally{fs.closeSync(fd)}if(require('crypto').createHash('sha256').update(fs.readFileSync(dest)).digest('hex')!==${JSON.stringify(hash)})throw Error('Guest digest mismatch');`);
        const assembled = await run('node', ['/tui-probe/assemble.cjs']);
        if (assembled.code !== 0 || assembled.timedOut) throw Error(JSON.stringify(assembled));
        report.delivery.push({ file: asset.file, sha256: hash, verifiedInGuest: true });
      }
      for (const target of ['node', 'bun']) report.cases.push(await run(target, [`/tui-probe/${target}/renderer.cjs`]));
      report.phase = 'complete';
      report.gates = { actualOpenCodeTui: false, rendererInitialized: report.cases.some(x => x.output.includes('tui: initialized')), modelTask: 'not attempted; renderer gate first' };
    } catch (error) { report.phase = 'failed'; report.error = String(error); }
  })();
});
return 'TUI worker qualification started; inspect window.tuiQualification';

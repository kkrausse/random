// Browser Control, after boot. Packaging bypasses npm's platform gate only.
await page.evaluate(({ entry, recover }) => {
  if (!["host", "sqlite-adapter"].includes(entry)) throw Error("Unknown probe entry");
  const vm = window.probe.vm;
  window.packagedProbe = { output: "", phase: "delivery", start: performance.now() };
  const report = window.packagedProbe;
  async function run(file) {
    const proc = await vm.spawn("bun", [file], { cwd: "/opencode-packaged", env: { VV_TRACE_MODULES: "1", OPENCODE_PROBE_RECOVER: recover ? "1" : "0" } });
    const timer = setTimeout(() => { report.timedOut = true; proc.kill(); }, 90000);
    const drain = (async () => { for await (const text of proc.output) report.output += text; })();
    const code = await proc.exit;
    clearTimeout(timer);
    await drain;
    report.code = code;
    if (code !== 0) throw Error(`${file} exited ${code}`);
  }
  void (async () => {
    try {
      const response = await fetch(`/.runtime/opencode-package/${entry}.txt`);
      if (!response.ok) throw Error(`Package fetch: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const receipt = await (await fetch(`/.runtime/opencode-package/${entry}-receipt.json`)).json();
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
      if (hash !== receipt.sha256) throw Error("Package digest mismatch");
      report.receipt = receipt;
      await vm.fs.mkdir("/opencode-packaged", { recursive: true });
      // SDK writeFile uses a bounded SAB; guest fd IO handles large files.
      let count = 0;
      for (let offset = 0; offset < bytes.length; offset += 262144) {
        await vm.fs.writeFile(`/opencode-packaged/part-${count++}`, bytes.slice(offset, offset + 262144));
      }
      await vm.fs.writeFile("/opencode-packaged/assemble.cjs", `const fs=require('node:fs'); const fd=fs.openSync('/opencode-packaged/host.cjs','w'); try { for(let i=0;i<${count};i++){ const p='/opencode-packaged/part-'+i; fs.writeSync(fd,fs.readFileSync(p)); fs.unlinkSync(p); } } finally { fs.closeSync(fd); } const bytes=fs.readFileSync('/opencode-packaged/host.cjs');if(require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==${JSON.stringify(hash)})throw Error('Guest package digest mismatch');console.log('checkpoint: delivered',bytes.length);`);
      await run("assemble.cjs");
      report.phase = "host";
      await run("host.cjs");
      if (!report.output.includes(receipt.successMarker)) throw Error("Process exited without required checkpoint");
      report.phase = "passed";
    } catch (error) {
      report.error = String(error);
      report.phase = "failed";
    } finally { report.ms = performance.now() - report.start; }
  })();
}, { entry: state.opencodeEntry ?? "host", recover: state.opencodeRecover ?? false });
return "Packaged SDK probe started; inspect window.packagedProbe";

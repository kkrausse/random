// Browser Control, after boot. Packaging bypasses npm's platform gate only.
await page.evaluate(({ entry, recover, durable }) => {
  if (!["host", "sqlite-adapter"].includes(entry)) throw Error("Unknown probe entry");
  const vm = window.probe.vm;
  window.packagedProbe = { output: "", phase: "delivery", start: performance.now() };
  const report = window.packagedProbe;
  async function run(file) {
    const proc = await vm.spawn("bun", [file], { cwd: "/opencode-packaged", env: { VV_TRACE_MODULES: "1", OPENCODE_PROBE_RECOVER: recover ? "1" : "0", OPENCODE_PROBE_DURABLE: durable ? "1" : "0" } });
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
      const receipt = await (await fetch(`/.runtime/opencode-package/${entry}-receipt.json`)).json();
      report.receipt = receipt;
      await vm.fs.mkdir("/opencode-packaged", { recursive: true });
      for (const asset of [{ file: `${entry}.txt`, destination: "/opencode-packaged/host.cjs", sha256: receipt.sha256, bytes: receipt.bytes }, ...(receipt.assets ?? [])]) {
      const response = await fetch(`/.runtime/opencode-package/${asset.file}`);
      if (!response.ok) throw Error(`Package fetch: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
      if (hash !== asset.sha256 || bytes.length !== asset.bytes) throw Error(`Package digest/size mismatch: ${asset.file}`);
      // SDK writeFile uses a bounded SAB; guest fd IO handles large files.
      let count = 0;
      for (let offset = 0; offset < bytes.length; offset += 262144) {
        await vm.fs.writeFile(`/opencode-packaged/part-${count++}`, bytes.slice(offset, offset + 262144));
      }
      await vm.fs.writeFile("/opencode-packaged/assemble.cjs", `const fs=require('node:fs'); const dest=${JSON.stringify(asset.destination)};fs.mkdirSync(require('node:path').dirname(dest),{recursive:true}); const fd=fs.openSync(dest,'w'); try { for(let i=0;i<${count};i++){ const p='/opencode-packaged/part-'+i; fs.writeSync(fd,fs.readFileSync(p)); fs.unlinkSync(p); } } finally { fs.closeSync(fd); } const bytes=fs.readFileSync(dest);if(require('node:crypto').createHash('sha256').update(bytes).digest('hex')!==${JSON.stringify(hash)})throw Error('Guest package digest mismatch');console.log('checkpoint: delivered',dest,bytes.length);`);
      await run("assemble.cjs");
      }
      report.phase = "host";
      await run("host.cjs");
      if (!report.output.includes(receipt.successMarker)) throw Error("Process exited without required checkpoint");
      report.phase = "passed";
    } catch (error) {
      report.error = String(error);
      report.phase = "failed";
    } finally { report.ms = performance.now() - report.start; }
  })();
}, { entry: state.opencodeEntry ?? "host", recover: state.opencodeRecover ?? false, durable: state.opencodeDurable ?? false });
return "Packaged SDK probe started; inspect window.packagedProbe";

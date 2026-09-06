const root = [".", "browser-container-poc", ".."].map(p => path.resolve(p)).find(p => fs.existsSync(path.join(p, "vivari/package.json")));
const source = fs.readFileSync(path.join(root, "vivari/probes/runtime/sqlite-owner.cjs"), "utf8");
await page.evaluate(async source => {
  const vm = window.probe.vm;
  await vm.mount({ "sqlite-owner.cjs": { file: { contents: source } } }, { mountPoint: "/runtime-probe" });
  const report = window.sqliteOwnerProbe = { phase: "running", results: [] };
  void (async () => {
    let holder;
    try {
      holder = await vm.spawn("node", ["sqlite-owner.cjs", "hold"], { cwd: "/runtime-probe" });
      const held = { test: "hold", output: "" };
      report.results.push(held);
      const stream = (async () => { for await (const text of holder.output) held.output += text; })();
      const deadline = performance.now() + 10000;
      while (!held.output.includes("SQLITE_OWNER_HELD") && performance.now() < deadline) await new Promise(r => setTimeout(r, 20));
      if (!held.output.includes("SQLITE_OWNER_HELD")) throw new Error("Holder did not become ready");
      async function run(mode) {
        const p = await vm.spawn("node", ["sqlite-owner.cjs", mode], { cwd: "/runtime-probe" });
        const r = { test: mode, output: "" };
        report.results.push(r);
        const timeout = setTimeout(() => p.kill(), 10000);
        try {
          const s = (async () => { for await (const text of p.output) r.output += text; })();
          r.code = await p.exit;
          await s;
          if (r.code !== 0) throw new Error(`${mode} exited ${r.code}`);
        } finally { clearTimeout(timeout); }
      }
      await run("contend");
      holder.kill();
      held.code = await holder.exit;
      await stream;
      if (held.code !== 143) throw new Error(`Unexpected killed status ${held.code}`);
      await run("recover");
      report.phase = "complete";
    } catch (error) { report.phase = "failed"; report.error = String(error); }
    finally { holder?.kill(); }
  })();
}, source);
return "Ownership probe started; inspect window.sqliteOwnerProbe";

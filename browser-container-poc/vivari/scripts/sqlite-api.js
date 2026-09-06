// Browser Control runner. Re-run with state.sqliteMode='recover' after reload.
const root = [".", "browser-container-poc", ".."].map(p => path.resolve(p)).find(p => fs.existsSync(path.join(p, "vivari/package.json")));
if (!root) throw new Error("Cannot locate POC");
const source = fs.readFileSync(path.join(root, "vivari/probes/runtime/sqlite-api.cjs"), "utf8");
await page.evaluate(async ({ source, mode }) => {
  const vm = window.probe?.vm;
  if (!vm) throw new Error("Boot Vivari first");
  await vm.mount({ "sqlite-api.cjs": { file: { contents: source } } }, { mountPoint: "/runtime-probe" });
  const report = window.sqliteApiProbe = { phase: "running", results: [] };
  void (async () => {
    try {
      for (const command of ["node", "bun"]) for (const test of mode === "recover" ? ["recover"] : ["memory", "write", "recover"]) {
        const proc = await vm.spawn(command, ["sqlite-api.cjs", test], { cwd: "/runtime-probe" });
        const result = { command, test, output: "", timedOut: false };
        report.results.push(result);
        const timeout = setTimeout(() => { result.timedOut = true; proc.kill(); }, 30000);
        try {
          const stream = (async () => { for await (const text of proc.output) result.output += text; })();
          result.code = await proc.exit;
          await stream;
          if (result.code !== 0) throw new Error(`${test} exited ${result.code}`);
        } finally { clearTimeout(timeout); }
      }
      report.phase = "complete";
    } catch (error) { report.phase = "failed"; report.error = String(error); }
  })();
}, { source, mode: state.sqliteMode });
return "SQLite API tests started; inspect window.sqliteApiProbe";

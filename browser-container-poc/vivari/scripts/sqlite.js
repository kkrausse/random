// Browser Control after boot: install pinned sql.js, query, export, reopen in a new process.
const root = [".", "browser-container-poc", ".."].map(p => path.resolve(p)).find(p => fs.existsSync(path.join(p, "vivari/package.json")));
if (!root) throw new Error("Cannot locate POC");
const tree = {};
for (const name of ["package.json", "check.cjs"]) {
  tree[name] = { file: { contents: fs.readFileSync(path.join(root, "vivari/probes/sqlite", name), "utf8") } };
}
await page.evaluate(async tree => {
  const vm = window.probe?.vm;
  if (!vm) throw new Error("Boot Vivari first");
  if (window.sqliteProbe?.phase === "running") throw new Error("Probe already running");
  await vm.mount(tree, { mountPoint: "/sqlite-probe" });
  const report = window.sqliteProbe = { phase: "running", results: [], versions: window.probe.versions };
  void (async () => {
    try {
      for (const [command, ...args] of [
        ["npm", "install", "--no-audit", "--no-fund", "--ignore-scripts"],
        ["bun", "check.cjs", "write"],
        ["bun", "check.cjs", "recover"],
      ]) {
        const result = { command, args, output: "", timedOut: false };
        report.results.push(result);
        const start = performance.now();
        const proc = await vm.spawn(command, args, { cwd: "/sqlite-probe" });
        const timer = setTimeout(() => { result.timedOut = true; proc.kill(); }, 90000);
        try {
          const stream = (async () => { for await (const text of proc.output) result.output += text; })();
          result.code = await proc.exit;
          await stream;
        } finally { clearTimeout(timer); result.ms = performance.now() - start; }
        if (result.timedOut || result.code !== 0) throw new Error(`${command} failed`);
        if (command === "bun" && !result.output.includes('"ok":true')) throw new Error("Missing success marker");
      }
      report.package = JSON.parse(await vm.fs.readFile("/sqlite-probe/node_modules/sql.js/package.json", "utf-8")).version;
      report.phase = "complete";
    } catch (error) { report.phase = "failed"; report.error = String(error); }
  })();
}, tree);
return "SQLite WASM probe started; inspect window.sqliteProbe.";

// Browser Control: run after boot. No SDK install or workspace edits required.
const root = [".", "browser-container-poc", ".."].map(p => path.resolve(p)).find(p => fs.existsSync(path.join(p, "vivari/package.json")));
if (!root) throw new Error("Cannot locate POC");
const tree = {};
for (const name of fs.readdirSync(path.join(root, "vivari/probes/runtime"))) {
  tree[name] = { file: { contents: fs.readFileSync(path.join(root, "vivari/probes/runtime", name), "utf8") } };
}
await page.evaluate(async tree => {
  const vm = window.probe?.vm;
  if (!vm) throw new Error("Boot Vivari first");
  if (window.runtimeProbe?.phase === "running") throw new Error("Probe already running");
  await vm.mount(tree, { mountPoint: "/runtime-probe" });
  const report = window.runtimeProbe = { phase: "running", results: [], versions: window.probe.versions };
  void (async () => {
    try {
      for (const command of ["bun", "node"]) {
        for (const name of ["conditions", "bun-sqlite", "node-sqlite", "bun-ffi", "node-ffi", "filesystem", "subprocess"]) {
          const result = { command, name, output: "", timedOut: false };
          report.results.push(result);
          const start = performance.now();
          const proc = await vm.spawn(command, ["check.cjs", name], { cwd: "/runtime-probe" });
          const timer = setTimeout(() => { result.timedOut = true; proc.kill(); }, 15000);
          try {
            const stream = (async () => { for await (const text of proc.output) result.output += text; })();
            result.code = await proc.exit;
            await stream;
          } finally { clearTimeout(timer); result.ms = performance.now() - start; }
        }
      }
      report.phase = "complete";
    } catch (error) { report.phase = "failed"; report.error = String(error); }
  })();
}, tree);
return "Runtime probe started; inspect window.runtimeProbe (14 isolated cases, 15s timeout each).";

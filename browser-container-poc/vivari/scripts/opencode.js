// Run with Browser Control after boot; actual installation/execution stays in Vivari.
const root = [".", "browser-container-poc", ".."].map(p => path.resolve(p)).find(p => fs.existsSync(path.join(p, "vivari/package.json")));
if (!root) throw new Error("Cannot locate POC");
const tree = {};
for (const name of ["package.json", "host.mjs"]) tree[name] = { file: { contents: fs.readFileSync(path.join(root, "vivari/probes/opencode", name), "utf8") } };
await page.evaluate(async tree => {
  const vm = window.probe.vm;
  await vm.mount(tree, { mountPoint: "/opencode-probe" });
  window.hostProbe = { output: "", phase: "install", start: performance.now() };
  async function run(command, args) {
    const proc = await vm.spawn(command, args, { cwd: "/opencode-probe" });
    window.hostProbe.process = proc;
    const timer = setTimeout(() => { window.hostProbe.timedOut = true; proc.kill(); }, 180000);
    const stream = (async () => { for await (const text of proc.output) window.hostProbe.output += text; })();
    const code = await proc.exit;
    clearTimeout(timer);
    await stream;
    if (code !== 0) throw new Error(`${command} exited ${code}`);
  }
  void (async () => {
    try {
      await run("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"]);
      window.hostProbe.phase = "host";
      await run("bun", ["host.mjs"]);
      window.hostProbe.phase = "passed";
    } catch (error) {
      window.hostProbe.error = String(error);
      window.hostProbe.phase = "failed";
    } finally { window.hostProbe.ms = performance.now() - window.hostProbe.start; }
  })();
}, tree);
return "OpenCode host probe started; inspect window.hostProbe for output and phase";

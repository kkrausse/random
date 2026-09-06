const root = [".", "browser-container-poc", ".."].map(p => path.resolve(p)).find(p => fs.existsSync(path.join(p, "vivari/package.json")));
if (!root) throw new Error("Cannot locate POC");
const report = await page.evaluate(async () => {
  const { vm, samples, versions } = window.probe;
  const manifest = JSON.parse(await vm.fs.readFile("/workspace/package.json", "utf-8"));
  const dependencies = {};
  for (const [name, expected] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    try {
      dependencies[name] = { expected, actual: JSON.parse(await vm.fs.readFile(`/workspace/node_modules/${name}/package.json`, "utf-8")).version };
    } catch (error) { dependencies[name] = { expected, error: String(error) }; }
  }
  return {
    date: new Date().toISOString(), origin: location.origin,
    userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency,
    versions, samples, dependencies,
    source: await vm.fs.readFile("/workspace/src/WelcomeCard.tsx", "utf-8"),
    output: document.querySelector("#output").textContent,
    host: window.hostProbe && { phase: window.hostProbe.phase, error: window.hostProbe.error, output: window.hostProbe.output, ms: window.hostProbe.ms },
  };
});
const dir = path.join(root, "doc/logs/vivari");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${Date.now()}-capture.json`);
fs.writeFileSync(file, JSON.stringify(report, null, 2));
return { file, samples: report.samples, dependencies: report.dependencies, host: report.host };

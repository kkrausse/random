// browser-control execute --session <id> --file scripts/profile.js
await page.bringToFront();
const report = await page.evaluate(async () => {
  const { vm, samples, versions } = window.probe;
  const frame = document.querySelector("#preview");
  const path = "/workspace/src/WelcomeCard.tsx";
  const original = await vm.fs.readFile(path, "utf-8");
  const heading = original.match(/<h1>([^<]+)<\/h1>/)?.[1];
  if (!heading) throw new Error("Expected plain-text fixture heading");
  if (frame.contentDocument?.querySelector("h1")?.textContent !== heading) throw new Error("Start Vite and wait for the original fixture heading before profiling");
  const results = [];
  let failure;
  const wait = (text, oldDocument, replaced) => new Promise((resolve, reject) => {
    const deadline = performance.now() + 30000;
    function tick() {
      const doc = frame.contentDocument;
      const h1 = doc?.querySelector("h1");
      if (h1?.textContent === text && h1.getBoundingClientRect().height > 0 && (!replaced || doc !== oldDocument)) {
        if (!replaced && doc !== oldDocument) return reject(new Error("HMR replaced the preview document"));
        return resolve(performance.now());
      }
      if (performance.now() > deadline) return reject(new Error(`Timed out waiting for ${text}`));
      requestAnimationFrame(tick);
    }
    tick();
  });
  try {
    for (let i = 0; i < 5; i++) {
      const text = `Vivari edit ${i + 1}`;
      const doc = frame.contentDocument;
      const start = performance.now();
      await vm.fs.writeFile(path, original.replace(`<h1>${heading}</h1>`, `<h1>${text}</h1>`));
      results.push({ phase: "edit", order: i + 1, ms: await wait(text, doc, false) - start });
      // Leave the watcher throttle window between distinct user interactions.
      await new Promise(resolve => setTimeout(resolve, 150));
      const restore = performance.now();
      await vm.fs.writeFile(path, original);
      results.push({ phase: "restore", order: i + 1, ms: await wait(heading, doc, false) - restore });
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    for (let i = 0; i < 3; i++) {
      const doc = frame.contentDocument;
      const start = performance.now();
      frame.contentWindow.location.reload();
      results.push({ phase: "reload", order: i + 1, ms: await wait(heading, doc, true) - start });
    }
  } catch (error) {
    failure = String(error);
  } finally {
    await vm.fs.writeFile(path, original);
  }
  return {
    date: new Date().toISOString(), userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory,
    versions, startup: samples, results, failure,
    cache: "Existing runtime, installed dependencies, first preview already visible; five edits with restorations (150ms pacing outside timed regions) then three preview-only reloads",
  };
});
// Browser Control evaluates filesystem paths relative to its relay workspace.
const root = [".", "browser-container-poc", ".."].map(p => path.resolve(p)).find(p => fs.existsSync(path.join(p, "vivari/package.json")));
if (!root) throw new Error("Cannot locate browser-container-poc from the relay workspace");
const dir = path.join(root, "doc/logs/vivari");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${Date.now()}-profile.json`);
fs.writeFileSync(file, JSON.stringify(report, null, 2));
return { file, report };

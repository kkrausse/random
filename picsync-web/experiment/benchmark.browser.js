// Run with browser-control execute --session <id> --file <this file> after
// navigating that session to the isolated experiment. Results include all RGBA
// differences against a one-worker reference, not just a thumbnail comparison.
await page.bringToFront();
return await page.evaluate(async () => {
  if (!crossOriginIsolated) throw new Error("Benchmark requires an isolated context");
  const samples = (await (await fetch("/samples")).json()).filter(s => /\.arw$/i.test(s.name));
  const results = [];
  async function decode(id, halfSize, count) {
    return new Promise((resolve, reject) => {
      let hiddenSince = document.hidden ? performance.now() : null;
      let hiddenMs = 0;
      let wasHidden = document.hidden;
      const focusedAtStart = document.hasFocus();
      const visibility = () => {
        if (document.hidden) {
          wasHidden = true;
          hiddenSince ??= performance.now();
        } else if (hiddenSince !== null) {
          hiddenMs += performance.now() - hiddenSince;
          hiddenSince = null;
        }
      };
      document.addEventListener("visibilitychange", visibility);
      const worker = new Worker("/parallel-worker.js", { type: "module" });
      const stop = () => {
        clearTimeout(timeout); worker.terminate();
        document.removeEventListener("visibilitychange", visibility);
        if (hiddenSince !== null) hiddenMs += performance.now() - hiddenSince;
      };
      const timeout = setTimeout(() => { stop(); reject(new Error("Decode timeout")); }, 120000);
      worker.onerror = event => { event.preventDefault(); stop(); reject(new Error(event.message)); };
      worker.onmessage = ({ data }) => {
        if (data.stage) return;
        stop();
        if (data.error) reject(new Error(data.error));
        else resolve({ ...data, wasHidden, hiddenMs, focusedAtStart, focusedAtEnd: document.hasFocus() });
      };
      worker.postMessage({ id, halfSize, count });
    });
  }
  for (const sample of samples) {
    for (const halfSize of [true, false]) {
      let reference;
      for (const count of [1, 2, 4]) {
        const { rgba, ...timings } = await decode(sample.id, halfSize, count);
        let max = 0, sum = 0, changed = 0;
        if (reference) {
          if (reference.length !== rgba.length) throw new Error("Output size mismatch");
          for (let i = 0; i < rgba.length; i++) {
            const difference = Math.abs(rgba[i] - reference[i]);
            max = Math.max(max, difference);
            sum += difference;
            if (difference) changed++;
          }
        } else reference = rgba;
        results.push({ name: sample.name, halfSize, ...timings,
          diff: { max, mean: sum / rgba.length, changed } });
      }
    }
  }
  return { userAgent: navigator.userAgent, logicalCPUs: navigator.hardwareConcurrency,
    isolated: crossOriginIsolated, timestamp: new Date().toISOString(), results };
});

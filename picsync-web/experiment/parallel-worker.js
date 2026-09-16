// One photo, multiple overlapping LibRaw crop developments. Each instance still
// unpacks the whole original: this measures whether parallel development pays off.
import { stitchStrips } from "/stitch-strips.js";
self.onmessage = async ({ data: { id, halfSize, count } }) => {
  const workers = [];
  try {
    if (!crossOriginIsolated) throw new Error("Use HTTPS (or localhost) with isolation headers");
    if (![1, 2, 4].includes(count)) throw new Error("Invalid worker count");
    const started = performance.now();
    self.postMessage({ stage: "Downloading original once…" });
    const response = await fetch(`/original/${id}`);
    if (!response.ok) throw new Error(`Original request: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const downloaded = performance.now();
    self.postMessage({ stage: `Developing one RAW with ${count} strip worker(s)…` });
    const strips = await Promise.all(Array.from({ length: count }, (_, index) =>
      new Promise((resolve, reject) => {
        const worker = new Worker("/strip-worker.js", { type: "module" });
        workers.push(worker);
        worker.onerror = event => { event.preventDefault(); reject(new Error(event.message)); };
        worker.onmessage = ({ data }) => {
          worker.terminate();
          if (data.error) reject(new Error(data.error)); else resolve(data);
        };
        const copy = count === 1 ? bytes : bytes.slice();
        worker.postMessage({ bytes: copy, halfSize, count, index }, [copy.buffer]);
      })));
    const decoded = performance.now();
    const oriented = stitchStrips(strips);
    self.postMessage({ ...oriented, camera: strips[0].camera, count,
      downloadMs: downloaded - started, decodeMs: decoded - downloaded,
      packMs: performance.now() - decoded,
      strips: strips.map(({ openMs, imageMs, y, height }) => ({ openMs, imageMs, y, height })),
    }, [oriented.rgba.buffer]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    for (const worker of workers) worker.terminate();
  }
};

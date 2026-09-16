let active = null;
let displayed = null;

export function addWasmControls(card, sample) {
  if (!/\.(arw|dng)$/i.test(sample.name)) return;
  const controls = document.createElement("div");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel / clear RAW";
  cancel.hidden = true;
  let canvas;
  const clear = () => {
    if (canvas) { canvas.width = canvas.height = 0; canvas.remove(); canvas = null; }
  };
  for (const halfSize of [true, false]) {
    const button = document.createElement("button");
    button.textContent = halfSize ? "WASM · half resolution" : "WASM · full resolution";
    button.onclick = () => {
      active?.();
      displayed?.();
      displayed = null;
      clear();
      status.textContent = "Starting RAW worker…";
      cancel.hidden = false;
      const started = performance.now();
      const worker = new Worker("/raw-worker.js", { type: "module" });
      let timeout;
      const stop = () => {
        worker.terminate();
        clearTimeout(timeout);
        if (active === abort) active = null;
      };
      const abort = () => { stop(); status.textContent = "Cancelled"; cancel.hidden = true; };
      const fail = (message) => { stop(); clear(); status.textContent = `WASM FAIL: ${message}`; cancel.hidden = true; };
      active = abort;
      cancel.onclick = () => { stop(); clear(); status.textContent = "Cleared"; cancel.hidden = true; };
      timeout = setTimeout(() => fail("Timed out after 120 seconds"), 120000);
      worker.onerror = (event) => { event.preventDefault(); fail(event.message || "Worker failed to load"); };
      worker.onmessage = ({ data }) => {
        if (data.stage) { status.textContent = data.stage; return; }
        if (data.error) { fail(data.error); return; }
        try {
          canvas = document.createElement("canvas");
          canvas.width = data.width;
          canvas.height = data.height;
          canvas.setAttribute("aria-label", `RAW render of ${sample.name}`);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Browser could not allocate a canvas");
          context.putImageData(new ImageData(data.rgba, data.width, data.height), 0, 0);
          card.append(canvas);
          status.textContent = `WASM PASS: ${data.width} × ${data.height} · ${data.camera} · download ${(data.downloadMs / 1000).toFixed(1)} s · decode ${(data.decodeMs / 1000).toFixed(1)} s · total ${((performance.now() - started) / 1000).toFixed(1)} s`;
          displayed = () => { clear(); cancel.hidden = true; };
          stop();
        } catch (error) { fail(error.message); }
      };
      worker.postMessage({ id: sample.id, halfSize });
    };
    controls.append(button);
  }
  controls.append(cancel, status);
  card.append(controls);
}

window.addEventListener("pagehide", () => { active?.(); displayed?.(); });

let active = null;
let displayed = null;

export function addWasmControls(card, sample) {
  if (!/\.(arw|dng)$/i.test(sample.name)) return;
  const controls = document.createElement("div");
  const label = document.createElement("label");
  label.textContent = "Decoder: ";
  const decoder = document.createElement("select");
  for (const [value, text] of [
    ["legacy", "Legacy 1.0.5"], ["modern", "Modern 1.6.0"],
    ["1", "Strip baseline · 1 worker"], ["2", "Parallel strips · 2 workers"],
    ["4", "Parallel strips · 4 workers"],
  ]) {
    const option = new Option(text, value);
    option.disabled = value !== "legacy" && !crossOriginIsolated;
    decoder.append(option);
  }
  decoder.value = crossOriginIsolated ? "modern" : "legacy";
  label.append(decoder);
  controls.append(label, document.createElement("br"));
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
      let wasHidden = document.hidden;
      const visibilityChanged = () => { wasHidden ||= document.hidden; };
      document.addEventListener("visibilitychange", visibilityChanged);
      const count = Number(decoder.value);
      const mode = decoder.selectedOptions[0].textContent;
      const worker = new Worker(count ? "/parallel-worker.js" : "/raw-worker.js", { type: "module" });
      let timeout;
      const stop = () => {
        worker.terminate();
        clearTimeout(timeout);
        document.removeEventListener("visibilitychange", visibilityChanged);
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
          status.textContent = `WASM PASS: ${mode} · ${data.width} × ${data.height} · ${data.camera} · download ${(data.downloadMs / 1000).toFixed(1)} s · decode ${(data.decodeMs / 1000).toFixed(1)} s · total ${((performance.now() - started) / 1000).toFixed(1)} s · ${wasHidden ? "tab was backgrounded; timing may be throttled" : "foreground throughout"}`;
          displayed = () => { clear(); cancel.hidden = true; };
          stop();
        } catch (error) { fail(error.message); }
      };
      worker.postMessage({ id: sample.id, halfSize, modern: decoder.value === "modern", count });
    };
    controls.append(button);
  }
  controls.append(cancel, status);
  card.append(controls);
}

window.addEventListener("pagehide", () => { active?.(); displayed?.(); });

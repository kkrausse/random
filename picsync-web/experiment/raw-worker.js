// One decode per worker. Termination releases the entire WASM heap afterward.
self.onmessage = async ({ data: { id, halfSize, modern = false } }) => {
  let raw;
  try {
    if (modern && !crossOriginIsolated) throw new Error("Modern decoder requires localhost or isolated HTTPS");
    const started = performance.now();
    self.postMessage({ stage: "Downloading original…" });
    const response = await fetch(`/original/${id}`);
    if (!response.ok) throw new Error(`Original request: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const downloaded = performance.now();
    const { default: LibRaw } = await import(modern ? "/modern/index.js" : "/vendor/index.js");
    self.postMessage({ stage: "Developing RAW in WebAssembly…" });
    raw = new LibRaw();
    await raw.open(bytes, { halfSize, useCameraWb: true, outputColor: 1, outputBps: 8 });
    const opened = performance.now();
    const metadata = await raw.metadata();
    const image = await raw.imageData();
    if (!image || image.bits !== 8 || image.colors !== 3 ||
        !image.width || !image.height || image.data?.length !== image.width * image.height * 3) {
      throw new Error("Decoder did not return a supported 8-bit RGB image");
    }
    const decoded = performance.now();
    const rgba = new Uint8ClampedArray(image.width * image.height * 4);
    for (let source = 0, target = 0; source < image.data.length; source += 3, target += 4) {
      rgba[target] = image.data[source];
      rgba[target + 1] = image.data[source + 1];
      rgba[target + 2] = image.data[source + 2];
      rgba[target + 3] = 255;
    }
    self.postMessage({
      width: image.width, height: image.height, rgba,
      camera: `${metadata.camera_make} ${metadata.camera_model}`,
      downloadMs: downloaded - started, decodeMs: decoded - downloaded,
      openMs: opened - downloaded, imageMs: decoded - opened,
    }, [rgba.buffer]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    raw?.dispose?.();
  }
};

import { stripPlan } from "./strip-plan.js";

// Shared by browser workers and the Bun/Node worker_threads benchmark. The
// caller supplies the module factory so both can load the identical WASM bytes.
export async function decodeStrip(createModule, { bytes, halfSize, count, index }) {
  let raw;
  try {
    const started = performance.now();
    const module = await createModule();
    raw = new module.LibRaw();
    // Fix global brightness/maximum so independently processed strips agree.
    const settings = { halfSize, useCameraWb: true, outputColor: 1, outputBps: 8,
      noAutoBright: true, adjustMaximumThr: 0, userFlip: 0, userQual: 3 };
    raw.open(bytes, settings);
    const metadata = raw.metadata(true);
    if (!metadata.filters || metadata.filters === 9 || metadata.colors !== 3) {
      throw new Error("Strip experiment currently supports three-color Bayer RAWs only");
    }
    // metadata is camera-oriented; userFlip: 0 develops sensor orientation.
    const width = metadata.flip & 4 ? metadata.height : metadata.width;
    const height = metadata.flip & 4 ? metadata.width : metadata.height;
    const plan = stripPlan(width, height, count, halfSize)[index];
    if (count > 1) raw.open(bytes, { ...settings, cropbox: plan.cropbox });
    const opened = performance.now();
    const image = raw.imageData();
    const decoded = performance.now();
    if (image.bits !== 8 || image.colors !== 3 || image.width !== plan.width ||
        image.height < plan.skip + plan.height || image.data.length !== image.width * image.height * 3) {
      throw new Error("Unexpected strip dimensions or pixel format");
    }
    const rgb = image.data.slice(plan.skip * plan.width * 3,
      (plan.skip + plan.height) * plan.width * 3);
    return { ...plan, rgb, flip: metadata.flip, camera: `${metadata.camera_make} ${metadata.camera_model}`,
      openMs: opened - started, imageMs: decoded - opened };
  } finally {
    raw?.delete();
  }
}

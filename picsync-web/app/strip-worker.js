import createLibRaw from "/modern/libraw.js";
import { decodeStrip } from "/decode-strip.js";
import { errorMessage } from "/error-details.js";

// One module/heap per pooled worker. decodeStrip deletes its per-photo LibRaw
// object; the module stays initialized until the pipeline disposes this worker.
let module;
self.onmessage = async ({ data }) => {
  let stage = "Start RAW decode";
  try {
    const result = await decodeStrip(() => module ??= createLibRaw(), data, (value) => { stage = value; });
    self.postMessage(result, [result.rgb.buffer]);
  } catch (error) {
    const details = { stage, strip: data.index, halfSize: data.halfSize,
      bytes: data.bytes?.byteLength, error: errorMessage(error) };
    console.error("[PicSync] RAW worker failed", details);
    self.postMessage({ error: `${stage} (strip ${data.index + 1}/${data.count}): ${details.error}`, details });
  }
};

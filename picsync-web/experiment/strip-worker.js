import createLibRaw from "/modern/libraw.js";
import { decodeStrip } from "/decode-strip.js";

self.onmessage = async ({ data }) => {
  try {
    const result = await decodeStrip(createLibRaw, data);
    self.postMessage(result, [result.rgb.buffer]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};

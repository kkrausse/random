import { orientRgba } from "./strip-plan.js";

export function stitchStrips(strips) {
  const { width, totalHeight: height, flip } = strips[0];
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const strip of strips) {
    for (let source = 0, target = strip.y * width * 4; source < strip.rgb.length; source += 3, target += 4) {
      rgba[target] = strip.rgb[source];
      rgba[target + 1] = strip.rgb[source + 1];
      rgba[target + 2] = strip.rgb[source + 2];
      rgba[target + 3] = 255;
    }
  }
  return orientRgba(rgba, width, height, flip);
}

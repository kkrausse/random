// Even boundaries preserve the Bayer phase; overlap supplies demosaicing neighbors.
export function stripPlan(width, height, count, halfSize) {
  if (![1, 2, 4].includes(count) || width % 2 || height % 2 || height < count * 2) {
    throw new Error("Strip experiment requires even dimensions and 1, 2 or 4 workers");
  }
  const scale = halfSize ? 2 : 1;
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(height / 2 * index / count) * 2;
    const end = Math.floor(height / 2 * (index + 1) / count) * 2;
    const top = Math.max(0, start - 32);
    const bottom = Math.min(height, end + 32);
    return {
      cropbox: [0, top, width, bottom - top],
      y: start / scale, skip: (start - top) / scale,
      width: width / scale, height: (end - start) / scale,
      totalHeight: height / scale,
    };
  });
}

// LibRaw's flip bits: transpose first, then reflect in the source coordinates.
export function orientRgba(source, width, height, flip) {
  if (!flip) return { rgba: source, width, height };
  const outWidth = flip & 4 ? height : width;
  const outHeight = flip & 4 ? width : height;
  const rgba = new Uint8ClampedArray(source.length);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      let row = flip & 4 ? x : y;
      let col = flip & 4 ? y : x;
      if (flip & 2) row = height - 1 - row;
      if (flip & 1) col = width - 1 - col;
      const from = (row * width + col) * 4;
      const to = (y * outWidth + x) * 4;
      rgba[to] = source[from];
      rgba[to + 1] = source[from + 1];
      rgba[to + 2] = source[from + 2];
      rgba[to + 3] = source[from + 3];
    }
  }
  return { rgba, width: outWidth, height: outHeight };
}

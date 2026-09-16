/** Identify bytes, not extensions: some iPhone uploads have misleading names. */
export function imageFormat(bytes: Uint8Array): string {
  const matches = (offset: number, signature: number[]) =>
    signature.every((value, index) => bytes[offset + index] === value);
  const text = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (matches(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (matches(0, [137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (text(0, 4) === "RIFF" && text(8, 4) === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(text(0, 6))) return "image/gif";
  if (text(4, 4) === "ftyp" && bytes.length >= 16) {
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    const brands = [text(8, 4)];
    for (let offset = 16; offset + 4 <= Math.min(boxSize, bytes.length, 256); offset += 4)
      brands.push(text(offset, 4));
    if (brands.some((brand) => ["avif", "avis"].includes(brand))) return "image/avif";
    if (brands.some((brand) => ["heic", "heix", "hevc", "hevx"].includes(brand))) return "image/heic";
    if (brands.some((brand) => ["mif1", "msf1"].includes(brand))) return "image/heif";
  }
  // ARW and DNG use TIFF containers. LibRaw validates the sensor data inside.
  if (matches(0, [73, 73, 42, 0]) || matches(0, [77, 77, 0, 42]) ||
      matches(0, [73, 73, 43, 0]) || matches(0, [77, 77, 0, 43])) return "raw";
  throw new Error(`Unrecognized image format (${bytes.byteLength} bytes; header ${
    Array.from(bytes.subarray(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join(" ")
  }). The file may be incomplete or mislabeled.`);
}

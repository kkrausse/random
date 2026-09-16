import { expect, test } from "bun:test";
import { imageFormat } from "./image-format";

test("native images mislabeled as RAW are identified from their bytes", () => {
  expect(imageFormat(new Uint8Array([255, 216, 255, 224]))).toBe("image/jpeg");
  expect(imageFormat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBe("image/png");
  expect(imageFormat(new TextEncoder().encode("RIFFxxxxWEBP"))).toBe("image/webp");
  for (const [brand, expected] of [["heic", "image/heic"], ["avif", "image/avif"], ["mif1", "image/heif"]]) {
    const bytes = new Uint8Array(24);
    new DataView(bytes.buffer).setUint32(0, 24);
    bytes.set(new TextEncoder().encode("ftypmif1"), 4);
    bytes.set(new TextEncoder().encode(brand), 16);
    expect(imageFormat(bytes)).toBe(expected!);
  }
});

test("TIFF-based RAW reaches LibRaw, incomplete or unrelated bytes do not", () => {
  expect(imageFormat(new Uint8Array([73, 73, 42, 0]))).toBe("raw");
  expect(imageFormat(new Uint8Array([77, 77, 0, 42]))).toBe("raw");
  expect(() => imageFormat(new Uint8Array())).toThrow("Unrecognized image format");
  expect(() => imageFormat(new TextEncoder().encode("<html>Login</html>"))).toThrow("Unrecognized image format");
});

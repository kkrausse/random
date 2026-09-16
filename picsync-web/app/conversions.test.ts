import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createConversions, createNativeConverter, type ConvertedImage } from "./conversions";

let root: string;
const image = (): ConvertedImage => ({ bytes: Buffer.alloc(16), width: 2, height: 2, source: "fixture" });
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "picsync-conversion-test-"));
  await Promise.all(Array.from({ length: 20 }, (_, i) => writeFile(join(root, `${i}.ARW`), "fixture")));
});
afterAll(() => rm(root, { recursive: true, force: true }));

test("ten native jobs run at once; duplicates share work, sizes are distinct, metadata invalidates cache", async () => {
  let active = 0, peak = 0, calls = 0;
  const render = createConversions(async () => {
    calls++;
    peak = Math.max(peak, ++active);
    await Bun.sleep(20);
    active--;
    return image();
  });
  const path = join(root, "0.ARW");
  const all = await Promise.all([...Array.from({ length: 20 }, (_, i) => render(join(root, `${i}.ARW`), true)), render(path, true)]);
  expect(peak).toBe(10);
  expect(calls).toBe(20);
  expect(all[0]).toBe(all[20]);
  expect(await render(path, true)).toBe(all[0]!);
  await render(path, false);
  expect(calls).toBe(21);
  await writeFile(path, "changed fixture");
  await render(path, true);
  expect(calls).toBe(22);
});

test("foreground promotes queued lookahead; abandoned requests leave queue; active results stay cached", async () => {
  let release!: () => void;
  const started: string[] = [];
  const render = createConversions(async path => {
    started.push(path);
    if (started.length === 1) await new Promise<void>(resolve => { release = resolve; });
    return image();
  }, { concurrency: 1 });
  const path = (i: number) => join(root, `${i}.ARW`);
  const first = render(path(0), true);
  while (!release) await Bun.sleep(1);
  const background = render(path(1), true, 10);
  const ahead = render(path(2), true, 10);
  const promoted = render(path(2), true, 0);
  const controller = new AbortController();
  const cancelled = render(path(3), true, 0, controller.signal).catch(error => error);
  await Bun.sleep(10);
  controller.abort();
  expect(await cancelled).toBeInstanceOf(Error);
  release();
  const results = await Promise.all([first, background, ahead, promoted]);
  expect(started).toEqual([path(0), path(2), path(1)]);
  expect(results[2]).toBe(results[3]);
  expect(await render(path(0), true)).toBe(results[0]!);
});

test("failed jobs release capacity and retry; JPEG cache is byte bounded", async () => {
  let calls = 0;
  const render = createConversions(async () => {
    if (++calls === 1) throw new Error("decoder failed");
    return image();
  }, { concurrency: 1, cacheBytes: 16 });
  const a = join(root, "0.ARW"), b = join(root, "1.ARW");
  await expect(render(a, true)).rejects.toThrow("decoder failed");
  await render(a, true);
  await render(b, true);
  await render(a, true);
  expect(calls).toBe(4);
});

test("native conversion checks signatures and preserves full dimensions and camera orientation", async () => {
  const path = join(root, "misnamed.ARW");
  await sharp({ create: { width: 640, height: 480, channels: 3, background: "red" } })
    .jpeg().withMetadata({ orientation: 6 }).toFile(path);
  const convert = createNativeConverter();
  const full = await convert(path, true);
  expect([full.width, full.height]).toEqual([480, 640]);
  expect(full.source).toBe("JPEG (server)");
  expect((await sharp(full.bytes).metadata()).orientation).toBeUndefined();
  const thumb = await convert(path, false);
  expect([thumb.width, thumb.height]).toEqual([240, 320]);
});

test("extracted thumbnails apply all eight RAW container orientations exactly once", async () => {
  const path = join(root, "orientation.ARW");
  await writeFile(path, Buffer.from([73, 73, 42, 0, ...Array(28).fill(0)]));
  const bytes = await sharp(Buffer.from(Array.from({ length: 12 * 8 * 3 }, (_, i) => i % 256)),
    { raw: { width: 12, height: 8, channels: 3 } }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" }).toBuffer();
  for (let orientation = 1; orientation <= 8; orientation++) {
    const convert = createNativeConverter(async () => ({ bytes, orientation }));
    const actual = await convert(path, false);
    const tagged = await sharp(bytes).withMetadata({ orientation }).png().toBuffer();
    const expected = await sharp(tagged).autoOrient().resize(320, 320, { fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb").jpeg({ quality: 72, chromaSubsampling: "4:2:0" }).toBuffer();
    expect(actual.bytes.equals(expected)).toBe(true);
    expect((await sharp(actual.bytes).metadata()).orientation).toBeUndefined();
  }
});

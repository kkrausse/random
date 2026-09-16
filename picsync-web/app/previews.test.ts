import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPreviews } from "./previews";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "picsync-previews-"));
  for (let i = 0; i < 16; i++) await writeFile(join(root, `${i}.ARW`), "fixture");
});
afterAll(() => rm(root, { recursive: true, force: true }));

test("preview extraction shares requests, caches results, and invalidates changed files", async () => {
  let calls = 0;
  const preview = createPreviews(async () => {
    calls++;
    await Bun.sleep(10);
    return { bytes: Buffer.from([255, 216, 255]), orientation: 6 };
  });
  const path = join(root, "0.ARW");
  const [a, b] = await Promise.all([preview(path), preview(path)]);
  expect(a).toBe(b);
  expect(calls).toBe(1);
  expect(await preview(path)).toBe(a);
  await writeFile(path, "changed fixture");
  await preview(path);
  expect(calls).toBe(2);
});

test("extraction is limited to ten processes and missing previews are cached", async () => {
  let active = 0, peak = 0, calls = 0;
  const preview = createPreviews(async () => {
    calls++;
    peak = Math.max(peak, ++active);
    await Bun.sleep(10);
    active--;
    return null;
  });
  expect(await Promise.all(Array.from({ length: 16 }, (_, i) => preview(join(root, `${i}.ARW`))))).toEqual(Array(16).fill(null));
  expect(peak).toBe(10);
  await preview(join(root, "1.ARW"));
  expect(calls).toBe(16);
});

test("failed extraction releases capacity and can be retried", async () => {
  let fail = true;
  const preview = createPreviews(async () => {
    if (fail) throw new Error("exiftool unavailable");
    return null;
  });
  await expect(preview(join(root, "2.ARW"))).rejects.toThrow("exiftool unavailable");
  fail = false;
  expect(await preview(join(root, "2.ARW"))).toBeNull();
});

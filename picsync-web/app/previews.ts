import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
export type Preview = { bytes: Buffer; orientation: number };
async function extract(path: string): Promise<Preview | null> {
  const options = { encoding: "buffer" as const, timeout: 30000, maxBuffer: 16 * 1024 * 1024 };
  for (const tag of ["PreviewImage", "JpgFromRaw", "ThumbnailImage"]) {
    const { stdout } = await exec("exiftool", ["-b", `-${tag}`, "--", path], options);
    if (stdout[0] !== 0xff || stdout[1] !== 0xd8 || stdout[2] !== 0xff) continue;
    const result = await exec("exiftool", ["-s3", "-n", "-Orientation", "--", path], options);
    const orientation = Number(result.stdout.toString().trim());
    return { bytes: stdout, orientation: orientation >= 1 && orientation <= 8 ? orientation : 1 };
  }
  return null;
}

/** Bounded Mac-side extraction; no persistent copies of private previews. */
export function createPreviews(read = extract) {
  const cache = new Map<string, Preview | null>();
  const pending = new Map<string, Promise<Preview | null>>();
  const waiting: (() => void)[] = [];
  let active = 0;
  let cacheBytes = 0;
  async function run(path: string) {
    if (active >= 2) {
      if (waiting.length >= 32) throw new Error("Preview extraction queue is full");
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else active++;
    try {
      return await read(path);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }
  return async (path: string) => {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Not a photo file");
    const key = `${path}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    if (cache.has(key)) {
      const preview = cache.get(key)!;
      cache.delete(key);
      cache.set(key, preview);
      return preview;
    }
    let task = pending.get(key);
    if (!task) {
      task = run(path).then((preview) => {
        cache.set(key, preview);
        cacheBytes += preview?.bytes.byteLength ?? 0;
        for (const [oldKey, old] of cache) {
          if (cacheBytes <= 32 * 1024 * 1024 && cache.size <= 256) break;
          cache.delete(oldKey);
          cacheBytes -= old?.bytes.byteLength ?? 0;
        }
        return preview;
      }).finally(() => pending.delete(key));
      pending.set(key, task);
    }
    return task;
  };
}

import { execFile } from "node:child_process";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { imageFormat } from "./image-format";
import { createPreviews } from "./previews";

const exec = promisify(execFile);
// Parallelism belongs to the job pool, not ten nested all-core image encoders.
sharp.concurrency(1);
sharp.cache(false);
export type ConvertedImage = { bytes: Buffer; width: number; height: number; source: string };
export type Convert = (path: string, full: boolean) => Promise<ConvertedImage>;

export function createNativeConverter(preview = createPreviews()): Convert {
  return async (path, full) => {
    const file = await open(path, "r");
    const header = Buffer.alloc(32);
    try { await file.read(header, 0, header.length, 0); }
    finally { await file.close(); }
    const format = imageFormat(header);
    let source: string | Buffer = path;
    let orientation: number | undefined;
    let temporary: string | undefined;
    try {
      if (format === "raw") {
        const embedded = full ? null : await preview(path);
        if (embedded) {
          source = embedded.bytes;
          orientation = embedded.orientation;
        } else {
          temporary = await mkdtemp(join(tmpdir(), "picsync-render-"));
          source = join(temporary, "developed.tiff");
          // No -h or embedded-preview option: develop all sensor pixels. LibRaw
          // applies camera orientation and emits sRGB, camera-white-balanced TIFF.
          await exec("dcraw_emu", ["-w", "-q", "3", "-o", "1", "-T", "-Z", source, path], {
            timeout: 120000, maxBuffer: 1024 * 1024,
            env: { ...process.env, OMP_NUM_THREADS: "1" },
          });
        }
      } else if (format === "image/heic" || format === "image/heif") {
        // Homebrew/libvips HEIC support varies; macOS ImageIO supports iPhone HEIC.
        temporary = await mkdtemp(join(tmpdir(), "picsync-render-"));
        source = join(temporary, "native.jpg");
        await exec("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "95", path, "--out", source], {
          timeout: 120000, maxBuffer: 1024 * 1024,
        });
      }
      let image = sharp(source);
      // Explicit EXIF transforms for extracted JPEGs, whose orientation metadata
      // can differ from the RAW container. Never rotate a developed TIFF twice.
      if (orientation) {
        if ([2, 4, 5, 7].includes(orientation)) image = image.flop();
        const angle = ({ 3: 180, 4: 180, 5: 270, 6: 90, 7: 90, 8: 270 } as Record<number, number>)[orientation];
        if (angle) image = image.rotate(angle);
      } else image = image.autoOrient();
      if (!full) image = image.resize(320, 320, { fit: "inside", withoutEnlargement: true });
      const { data, info } = await image.toColourspace("srgb")
        .jpeg({ quality: full ? 92 : 72, chromaSubsampling: full ? "4:4:4" : "4:2:0" })
        .toBuffer({ resolveWithObject: true });
      return { bytes: data, width: info.width, height: info.height,
        source: format === "raw" ? (full ? "RAW (server LibRaw)" : "RAW preview (server)") : `${format.slice(6).toUpperCase()} (server)` };
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  };
}

type Waiter = { resolve: (image: ConvertedImage) => void; reject: (error: unknown) => void };
type Task = { key: string; path: string; full: boolean; priority: number; active: boolean; waiters: Set<Waiter> };

/** Shared, metadata-keyed JPEG cache and foreground-first bounded native pool. */
export function createConversions(convert: Convert = createNativeConverter(), options: {
  concurrency?: number; cacheBytes?: number; cacheEntries?: number; queueSize?: number;
} = {}) {
  const concurrency = options.concurrency ?? 10;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) throw new Error("Conversion concurrency must be 1–10");
  const cache = new Map<string, ConvertedImage>();
  const pending = new Map<string, Task>();
  let active = 0, bytes = 0;
  const pump = () => {
    const queued = [...pending.values()].filter(t => !t.active).sort((a, b) => a.priority - b.priority);
    for (const task of queued) {
      if (active >= concurrency) break;
      task.active = true;
      active++;
      void Promise.resolve().then(() => convert(task.path, task.full)).then(image => {
        cache.set(task.key, image);
        bytes += image.bytes.byteLength;
        for (const [key, old] of cache) {
          if (bytes <= (options.cacheBytes ?? 512 * 1024 * 1024) && cache.size <= (options.cacheEntries ?? 1024)) break;
          cache.delete(key);
          bytes -= old.bytes.byteLength;
        }
        for (const waiter of task.waiters) waiter.resolve(image);
      }, error => {
        for (const waiter of task.waiters) waiter.reject(error);
      }).finally(() => {
        pending.delete(task.key);
        active--;
        pump();
      });
    }
  };
  return async (path: string, full: boolean, priority = 0, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const info = await stat(path);
    signal?.throwIfAborted();
    if (!info.isFile()) throw new Error("Not a photo file");
    const key = `${path}:${info.size}:${info.mtimeMs}:${info.ctimeMs}:${full}`;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    let task = pending.get(key);
    if (!task) {
      if (pending.size >= concurrency + (options.queueSize ?? 64)) throw new Error("Conversion queue is full");
      task = { key, path, full, priority, active: false, waiters: new Set() };
      pending.set(key, task);
    }
    task.priority = Math.min(task.priority, priority);
    const current = task;
    return new Promise<ConvertedImage>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const waiter: Waiter = {
        resolve: image => { cleanup(); resolve(image); },
        reject: error => { cleanup(); reject(error); },
      };
      const abort = () => {
        current.waiters.delete(waiter);
        if (!current.active && !current.waiters.size) pending.delete(key);
        waiter.reject(signal?.reason ?? new Error("Conversion cancelled"));
      };
      current.waiters.add(waiter);
      signal?.addEventListener("abort", abort, { once: true });
      queueMicrotask(pump);
    });
  };
}

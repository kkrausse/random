import { stitchStrips } from "../experiment/stitch-strips.js";
import { errorMessage } from "./error-details.js";
import { imageFormat } from "./image-format";

export type Photo = { name: string; path: string; bytes: number; raw: boolean };
export type Render = {
  url?: string;
  bitmap?: ImageBitmap;
  width: number;
  height: number;
  size: number;
  decodeMs?: number;
};
type Job = {
  photo: Photo;
  full: boolean;
  priority: number;
  key: string;
  bytes?: Uint8Array<ArrayBuffer>;
};
const MB = 1024 * 1024;
const PREVIEW_EDGE = 320;
export class Pipeline {
  renders = new Map<string, Render>();
  errors = new Map<string, string>();
  states = new Map<string, string>();
  private originals = new Map<string, Uint8Array<ArrayBuffer>>();
  private jobs = new Map<string, Job>();
  private downloading = new Set<string>();
  private downloadingPaths = new Set<string>();
  private decoding = new Map<string, number>();
  private controllers = new Set<AbortController>();
  private stops = new Set<() => void>();
  private idleWorkers: Worker[] = [];
  private reserved = 0;
  private dead = false;
  private pinned: string | undefined;
  private reported = 0;
  private reportWindow = 0;
  constructor(private changed: () => void) {}
  key(photo: Photo, full = false) {
    return `${photo.path}:${full ? "full" : "thumb"}`;
  }
  get(photo: Photo, full = false) {
    const key = this.key(photo, full),
      value = this.renders.get(key);
    if (value) {
      this.renders.delete(key);
      this.renders.set(key, value);
    }
    return value;
  }
  request(photo: Photo, full = false, priority = 10) {
    const key = this.key(photo, full);
    if (this.dead || this.renders.has(key) || this.errors.has(key)) return;
    const existing = this.jobs.get(key);
    if (existing) existing.priority = Math.min(existing.priority, priority);
    else this.jobs.set(key, { photo, full, priority, key });
    this.pump();
  }
  retry(photo: Photo, full: boolean) {
    this.errors.delete(this.key(photo, full));
    this.request(photo, full, 0);
  }
  previews(photos: Photo[]) {
    const wanted = new Set(photos.map((photo) => this.key(photo)));
    // Let active work finish, but discard offscreen work that has not started.
    for (const [key, job] of this.jobs) {
      if (!job.full && !wanted.has(key) &&
          !this.downloading.has(key) && !this.decoding.has(key)) {
        this.jobs.delete(key);
        this.states.delete(key);
      }
    }
    for (const photo of photos) this.request(photo, false, 5);
    this.pump();
  }
  reprioritize() {
    for (const job of this.jobs.values()) job.priority = 100;
  }
  pin(photo?: Photo) {
    this.pinned = photo ? this.key(photo, true) : undefined;
  }
  get activity() {
    return `${this.downloading.size}/8 downloads · ${this.decoderSlots}/10 decoder slots · ${this.jobs.size} queued`;
  }
  private get decoderSlots() {
    return [...this.decoding.values()].reduce((sum, count) => sum + count, 0);
  }
  private workerCount(job: Job) {
    return job.full ? 2 : 1;
  }
  private pump() {
    if (this.dead) return;
    const jobs = [...this.jobs.values()].sort(
      (a, b) => a.priority - b.priority,
    );
    for (const job of jobs) {
      if (this.decoding.has(job.key) || this.downloading.has(job.key)) continue;
      job.bytes ??= this.originals.get(job.photo.path);
      if (job.bytes) {
        const foreground = this.pinned ? this.jobs.get(this.pinned) : undefined;
        // Keep draining ready previews while the foreground is downloading:
        // otherwise their admission budget could block that download forever.
        const foregroundReady =
          foreground &&
          (foreground.bytes || this.originals.has(foreground.photo.path));
        if (
          this.decoderSlots + this.workerCount(job) <= 10 &&
          (!foregroundReady || job.key === this.pinned)
        )
          void this.decode(job);
      } else if (
        !this.downloadingPaths.has(job.photo.path) &&
        this.downloading.size < 8 &&
        (this.reserved + job.photo.bytes <= 256 * MB || this.reserved === 0)
      ) {
        // Bound downloaded-but-not-decoded bytes as well as active HTTP requests.
        const readyBytes = [...this.jobs.values()].reduce(
          (n, j) => n + (j.bytes?.byteLength ?? 0),
          0,
        );
        if (readyBytes + this.reserved < 256 * MB) void this.download(job);
      }
    }
    this.changed();
  }
  private async download(job: Job) {
    const controller = new AbortController();
    this.controllers.add(controller);
    this.downloading.add(job.key);
    this.downloadingPaths.add(job.photo.path);
    this.reserved += job.photo.bytes;
    this.states.set(job.key, "Downloading");
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(
        `/api/photo?path=${encodeURIComponent(job.photo.path)}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      job.bytes = new Uint8Array(await response.arrayBuffer());
      if (!this.dead) {
        for (const waiting of this.jobs.values())
          if (waiting.photo.path === job.photo.path) waiting.bytes = job.bytes;
        this.originals.delete(job.photo.path);
        this.originals.set(job.photo.path, job.bytes);
        let total = [...this.originals.values()].reduce(
          (n, b) => n + b.byteLength,
          0,
        );
        for (const [key, bytes] of this.originals) {
          if (total <= 192 * MB) break;
          this.originals.delete(key);
          total -= bytes.byteLength;
        }
      }
    } catch (e) {
      this.fail(job, e);
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
      this.downloading.delete(job.key);
      this.downloadingPaths.delete(job.photo.path);
      this.reserved -= job.photo.bytes;
      this.pump();
    }
  }
  private fail(job: Job, error: unknown) {
    if (!this.dead) {
      const message = error instanceof Error ? error.message : errorMessage(error);
      const report = {
        path: job.photo.path, mode: job.full ? "full" : "preview",
        stage: this.states.get(job.key) ?? "Unknown", bytes: job.bytes?.byteLength ?? null,
        expectedBytes: job.photo.bytes, error: errorMessage(error),
        browser: typeof navigator === "undefined" ? "unknown" : navigator.userAgent.slice(0, 256),
      };
      console.error("[PicSync] Photo job failed", report);
      if (Date.now() - this.reportWindow >= 60000) {
        this.reportWindow = Date.now();
        this.reported = 0;
      }
      if (this.reported++ < 20) {
        void fetch("/api/client-error", {
          method: "POST", headers: { "Content-Type": "application/json" },
          credentials: "same-origin", body: JSON.stringify(report), keepalive: true,
        }).catch(() => {}); // Reporting failures must never trigger more reports.
      }
      this.errors.set(
        job.key,
        message,
      );
    }
    this.jobs.delete(job.key);
    this.states.delete(job.key);
  }
  private async raw(job: Job): Promise<ImageBitmap> {
    if (!crossOriginIsolated)
      throw new Error("RAW development requires trusted HTTPS or localhost.");
    const workers: Worker[] = [];
    const count = this.workerCount(job);
    const cancels: (() => void)[] = [];
    let reusable = false;
    let stopped = false;
    const stop = () => {
      stopped = true;
      for (const worker of workers) worker.terminate();
      for (const cancel of cancels) cancel();
    };
    this.stops.add(stop);
    const timeout = setTimeout(stop, 120000);
    try {
      const strips = await Promise.all(
        Array.from({ length: count }, (_, index) => index).map(
          (index) =>
            new Promise<any>((resolve, reject) => {
              const worker = this.idleWorkers.pop() ??
                new Worker("/strip-worker.js", { type: "module" });
              workers.push(worker);
              cancels.push(() =>
                reject(new Error("Decode cancelled or timed out")),
              );
              worker.onerror = (event) => {
                event.preventDefault();
                reject(new Error(`RAW worker failed to load or execute: ${event.message || "No browser error details"}${event.filename ? ` (${event.filename}:${event.lineno})` : ""}`));
              };
              worker.onmessage = ({ data }) => {
                data.error ? reject(new Error(data.error)) : resolve(data);
              };
              const bytes = job.bytes!.slice();
              worker.postMessage(
                { bytes, halfSize: !job.full, count, index },
                [bytes.buffer],
              );
            }),
        ),
      );
      const image = stitchStrips(strips);
      const ratio = Math.min(1, PREVIEW_EDGE / Math.max(image.width, image.height));
      const bitmap = await createImageBitmap(
        new ImageData(image.rgba, image.width, image.height),
        job.full ? {} : {
          resizeWidth: Math.max(1, Math.round(image.width * ratio)),
          resizeHeight: Math.max(1, Math.round(image.height * ratio)),
          resizeQuality: "low",
        },
      );
      reusable = true;
      return bitmap;
    } finally {
      clearTimeout(timeout);
      if (reusable && !this.dead && !stopped) {
        for (const worker of workers) {
          worker.onmessage = null;
          worker.onerror = null;
          this.idleWorkers.push(worker);
        }
      } else stop();
      this.stops.delete(stop);
    }
  }
  private async decode(job: Job) {
    this.decoding.set(job.key, this.workerCount(job));
    this.states.set(
      job.key,
      job.full ? "Developing full resolution" : "Preparing preview",
    );
    const started = performance.now();
    let bitmap: ImageBitmap | undefined;
    try {
      // Reserve slots synchronously, but do not re-enter pump on a synchronous
      // signature failure while it is still walking the current queue.
      await Promise.resolve();
      if (this.dead) return;
      this.states.set(job.key, "Identify image format");
      const format = imageFormat(job.bytes!);
      this.states.set(job.key, format === "raw" ? "Develop RAW pixels" : `Decode ${format}`);
      if (format === "raw") bitmap = await this.raw(job);
      else {
        try {
          bitmap = await createImageBitmap(new Blob([job.bytes!], { type: format }),
            job.full ? {} : { resizeWidth: PREVIEW_EDGE, resizeQuality: "low" });
        } catch (error) {
          throw new Error(`This file contains ${format}, regardless of its filename. The browser could not decode it (it may be unsupported or damaged): ${errorMessage(error)}`);
        }
      }
      if (this.dead) return;
      if (job.full) {
        // Retain decoded pixels directly, matching the experiment. Full-size PNG
        // encoding added seconds of latency and a second image decode on display.
        this.renders.set(job.key, {
          bitmap,
          width: bitmap.width,
          height: bitmap.height,
          size: bitmap.width * bitmap.height * 4,
          decodeMs: performance.now() - started,
        });
        bitmap = undefined; // Ownership transfers to the bounded full-resolution cache.
      } else {
        const ratio = Math.min(1, PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
        canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Unable to allocate image canvas");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        bitmap = undefined;
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) =>
              b ? resolve(b) : reject(new Error("Image encoding failed")),
            "image/jpeg",
            0.72,
          ),
        );
        const width = canvas.width,
          height = canvas.height;
        canvas.width = canvas.height = 0;
        if (this.dead) return;
        this.renders.set(job.key, {
          url: URL.createObjectURL(blob),
          width,
          height,
          // Include displayed pixels, not only the much smaller JPEG payload.
          size: blob.size + width * height * 4,
        });
      }
      // Keep up to three full-size images within 256 MB (always retain the open
      // photo, even if it exceeds the budget); previews have a separate 48 MB budget.
      for (const full of [true, false]) {
        const entries = [...this.renders].filter(([key]) =>
          key.endsWith(full ? ":full" : ":thumb"),
        );
        let size = entries.reduce((n, [, r]) => n + r.size, 0),
          count = entries.length;
        for (const [key, render] of entries) {
          if (
            full
              ? count <= 3 && (size <= 256 * MB || count === 1)
              : size <= 48 * MB
          )
            break;
          if (key === this.pinned) continue;
          if (render.url) URL.revokeObjectURL(render.url);
          render.bitmap?.close();
          this.renders.delete(key);
          size -= render.size;
          count--;
        }
      }
      this.jobs.delete(job.key);
      this.states.delete(job.key);
    } catch (e) {
      this.fail(job, e);
    } finally {
      bitmap?.close();
      job.bytes = undefined;
      this.decoding.delete(job.key);
      this.pump();
    }
  }
  dispose() {
    this.dead = true;
    for (const c of this.controllers) c.abort();
    for (const stop of this.stops) stop();
    for (const worker of this.idleWorkers) worker.terminate();
    this.idleWorkers = [];
    for (const render of this.renders.values()) {
      if (render.url) URL.revokeObjectURL(render.url);
      render.bitmap?.close();
    }
    this.renders.clear();
    this.originals.clear();
    this.jobs.clear();
  }
}

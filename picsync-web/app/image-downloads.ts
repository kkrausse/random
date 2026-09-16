// Separate network budgets keep gallery loading independent of full images.
// Conversion/bitmap worker counts are independent.
export const THUMBNAIL_DOWNLOAD_WORKERS = 10;
export const FULL_DOWNLOAD_WORKERS = 2;

type Job = {
  url: string;
  priority: number;
  signal?: AbortSignal | null;
  controller?: AbortController;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
};

export function createImageDownloads(workers = FULL_DOWNLOAD_WORKERS,
  fetchImage: (url: string, options: RequestInit) => Promise<Response> = (url, options) => fetch(url, options)) {
  if (!Number.isInteger(workers) || workers < 1) throw new Error("Image download workers must be a positive integer");
  const queued = new Set<Job>();
  const active = new Set<Job>();
  const pump = () => {
    const jobs = [...queued].sort((a, b) => a.priority - b.priority);
    for (const job of jobs) {
      if (active.size >= workers) {
        const background = [...active].filter(j => !j.controller!.signal.aborted)
          .sort((a, b) => b.priority - a.priority)[0];
        if (background && background.priority > job.priority) background.controller!.abort();
        break;
      }
      queued.delete(job);
      active.add(job);
      const controller = new AbortController();
      job.controller = controller;
      void (async () => {
        try {
          const response = await fetchImage(job.url, { signal: controller.signal });
          // Own the slot through the entire body, not just response headers.
          const bytes = await response.arrayBuffer();
          controller.signal.throwIfAborted();
          job.resolve(new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers }));
          job.cleanup();
        } catch (error) {
          if (controller.signal.aborted && !job.signal?.aborted) {
            queued.add(job); // Preempted work resumes after foreground work.
          } else {
            job.cleanup();
            job.reject(error);
          }
        } finally {
          active.delete(job);
          pump();
        }
      })();
    }
  };
  return (url: string, options: RequestInit, priority: number) => new Promise<Response>((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) { reject(signal.reason); return; }
    const job: Job = { url, priority, signal, resolve, reject,
      cleanup: () => signal?.removeEventListener("abort", abort) };
    const abort = () => {
      queued.delete(job);
      job.controller?.abort();
      job.cleanup();
      reject(signal?.reason);
      pump();
    };
    signal?.addEventListener("abort", abort, { once: true });
    queued.add(job);
    pump();
  });
}

export const downloadImage = createImageDownloads(FULL_DOWNLOAD_WORKERS);
export const downloadThumbnail = createImageDownloads(THUMBNAIL_DOWNLOAD_WORKERS);

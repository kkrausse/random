import { renderURL } from "./image-backend";
import { downloadThumbnail, THUMBNAIL_DOWNLOAD_WORKERS } from "./image-downloads";

type Request = {
  path: string;
  controller: AbortController;
  loaded: (blob: Blob) => void;
  failed: () => void;
  distance: () => number;
};

// Visible tiles and one screen of lookahead enter this queue. Cancellation removes queued work and
// aborts in-flight HTTP requests so the server can drop its unstarted conversions.
export function createThumbnailQueue(concurrency = THUMBNAIL_DOWNLOAD_WORKERS, download: (url: string, options: RequestInit) => Promise<Response> = fetch) {
  const pending = new Set<Request>();
  let active = 0;
  const pump = () => {
    // Recompute at admission: visible tiles precede nearby lookahead, including
    // after a scroll changes the position of requests already waiting here.
    for (const request of [...pending].sort((a, b) => a.distance() - b.distance())) {
      if (active >= concurrency) break;
      pending.delete(request);
      active++;
      const { controller } = request;
      void (async () => {
        try {
          const response = await download(renderURL(request.path, false, 5), {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Thumbnail HTTP ${response.status}`);
          const blob = await response.blob();
          if (!controller.signal.aborted) request.loaded(blob);
        } catch {
          if (!controller.signal.aborted) request.failed();
        } finally {
          active--;
          pump();
        }
      })();
    }
  };
  return {
    request(path: string, loaded: Request["loaded"], failed: Request["failed"], distance = () => 0) {
      const request = { path, loaded, failed, distance, controller: new AbortController() };
      pending.add(request);
      // Batch intersection changes before admitting new work.
      queueMicrotask(pump);
      return () => {
        pending.delete(request);
        request.controller.abort();
      };
    },
  };
}

const queue = createThumbnailQueue(THUMBNAIL_DOWNLOAD_WORKERS, (url, options) => downloadThumbnail(url, options, 5));
const callbacks = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | undefined;

function refreshObserver() {
  observer?.disconnect();
  observer = new IntersectionObserver(entries => {
    // Drop old viewport work before admitting the destination viewport.
    for (const entry of entries) {
      if (!entry.isIntersecting) callbacks.get(entry.target)?.(false);
    }
    for (const entry of entries) {
      if (entry.isIntersecting) callbacks.get(entry.target)?.(true);
    }
  }, { rootMargin: `${window.innerHeight}px 0px` });
  for (const element of callbacks.keys()) observer.observe(element);
}

export function observeThumbnail(element: Element, callback: (visible: boolean) => void) {
  if (!observer) {
    refreshObserver();
    window.addEventListener("resize", refreshObserver);
  }
  callbacks.set(element, callback);
  observer!.observe(element);
  return () => {
    observer!.unobserve(element);
    callbacks.delete(element);
    if (!callbacks.size) {
      observer!.disconnect();
      observer = undefined;
      window.removeEventListener("resize", refreshObserver);
    }
  };
}

export const requestThumbnail = queue.request;

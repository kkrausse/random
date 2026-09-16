import { pipelineLimits } from "./pipeline-limits";

type Slot = { worker: Worker; ready: Promise<void>; tail: Promise<unknown> };

// Page-lifetime pool: folder pipelines borrow it but never destroy its heaps.
export function createRawWorkers(count = Math.min(2, pipelineLimits(undefined, "browser").workers)) {
  const slots: Slot[] = Array.from({ length: count }, () => {
    const worker = new Worker("/strip-worker.js", { type: "module" });
    const ready = exchange(worker, { type: "init" }).then(() => {});
    // Initialization failures are reported by photo jobs, without unhandled rejections.
    void ready.catch(() => {});
    return { worker, ready, tail: Promise.resolve() };
  });
  let next = 0;
  return {
    decode(bytes: Uint8Array<ArrayBuffer>, halfSize: boolean, signal: AbortSignal) {
      const slot = slots[next++ % slots.length]!;
      const result = slot.tail.then(async () => {
        await slot.ready;
        signal.throwIfAborted();
        const copy = bytes.slice();
        return exchange(slot.worker, { bytes: copy, halfSize, count: 1, index: 0 }, [copy.buffer], () => {
          // A hung/crashed worker is unusable. Do not allocate a replacement heap.
          slot.ready = Promise.reject(new Error("RAW worker stopped; reload the page to retry"));
          void slot.ready.catch(() => {});
        });
      });
      slot.tail = result.catch(() => {});
      return result;
    },
  };
}

function exchange(worker: Worker, message: unknown, transfer: Transferable[] = [], fatal = () => {}) {
  return new Promise<any>((resolve, reject) => {
    const finish = (error?: Error, data?: unknown) => {
      clearTimeout(timeout);
      worker.onmessage = null;
      worker.onerror = null;
      error ? reject(error) : resolve(data);
    };
    const stop = (message: string) => {
      worker.terminate();
      fatal();
      finish(new Error(message));
    };
    const timeout = setTimeout(() => stop("RAW worker timed out; reload the page to retry"), 120000);
    worker.onerror = (event) => {
      event.preventDefault();
      stop(`RAW worker failed to load or execute: ${event.message || "No browser error details"}`);
    };
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : undefined, data);
    try {
      worker.postMessage(message, transfer);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

let pool: ReturnType<typeof createRawWorkers> | undefined;
export function rawWorkers() {
  return pool ??= createRawWorkers();
}

import { expect, test } from "bun:test";
import { createRawWorkers } from "./raw-workers";

test("two eagerly initialized workers serialize jobs and survive photo errors and cancellation", async () => {
  const originalWorker = globalThis.Worker;
  const workers: any[] = [];
  globalThis.Worker = function () {
    const worker = {
      onmessage: null as any, onerror: null as any, terminated: false,
      messages: [] as any[],
      postMessage(message: any) { this.messages.push(message); },
      terminate() { this.terminated = true; },
      reply(data: any) { this.onmessage({ data }); },
    };
    workers.push(worker);
    return worker;
  } as any;
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  try {
    const pool = createRawWorkers(2);
    expect(workers).toHaveLength(2);
    expect(workers.map(w => w.messages)).toEqual([[{ type: "init" }], [{ type: "init" }]]);
    const signal = new AbortController().signal;
    const bytes = new Uint8Array([1, 2, 3]);
    const first = pool.decode(bytes, false, signal);
    const second = pool.decode(bytes, false, signal);
    const third = pool.decode(bytes, true, signal);
    await flush();
    expect(workers[0].messages).toHaveLength(1); // Wait for WASM readiness.
    workers.forEach(w => w.reply({ ready: true }));
    await flush();
    expect(workers.map(w => w.messages.length)).toEqual([2, 2]);
    const failed = first.catch(error => error);
    workers[0].reply({ error: "bad photo" });
    expect((await failed).message).toBe("bad photo");
    await flush();
    expect(workers[0].messages).toHaveLength(3);
    workers[0].reply({ rgb: "third" });
    workers[1].reply({ rgb: "second" });
    expect(await third).toEqual({ rgb: "third" });
    expect(await second).toEqual({ rgb: "second" });
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(pool.decode(bytes, false, cancelled.signal)).rejects.toThrow();
    expect(workers.map(w => w.messages.length)).toEqual([3, 2]);
    expect(workers.every(w => !w.terminated)).toBe(true);
    expect(workers).toHaveLength(2);
  } finally {
    globalThis.Worker = originalWorker;
  }
});

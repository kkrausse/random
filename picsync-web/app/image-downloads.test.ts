import { expect, test } from "bun:test";
import { createImageDownloads, downloadImage, downloadThumbnail } from "./image-downloads";

test("ten thumbnail downloads and two full downloads have independent capacity", async () => {
  const originalFetch = globalThis.fetch;
  const starts: string[] = [];
  const controller = new AbortController();
  globalThis.fetch = ((url: string, options: RequestInit) => {
    starts.push(url);
    return new Promise<Response>((_, reject) => {
      options.signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    });
  }) as typeof fetch;
  try {
    const requests = [
      ...Array.from({ length: 12 }, (_, i) => downloadThumbnail(`thumb-${i}`, { signal: controller.signal }, 5).catch(() => null)),
      ...Array.from({ length: 4 }, (_, i) => downloadImage(`full-${i}`, { signal: controller.signal }, i).catch(() => null)),
    ];
    expect(starts.filter(url => url.startsWith("thumb"))).toHaveLength(10);
    expect(starts.filter(url => url.startsWith("full"))).toEqual(["full-0", "full-1"]);
    controller.abort();
    await Promise.all(requests);
    await Bun.sleep(0);
    expect(starts).toHaveLength(12);
  } finally {
    controller.abort();
    await Bun.sleep(0);
    globalThis.fetch = originalFetch;
  }
});

test("one worker holds its slot through body download and foreground preempts background", async () => {
  const starts: string[] = [];
  const bodies: ReadableStreamDefaultController<Uint8Array>[] = [];
  let active = 0, maximum = 0;
  const download = createImageDownloads(1, async (url, { signal }) => {
    starts.push(url);
    maximum = Math.max(maximum, ++active);
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      bodies.push(controller);
      signal!.addEventListener("abort", () => { active--; controller.error(new Error("preempted")); }, { once: true });
    } });
    return new Response(stream);
  });
  const background = download("thumbnail", {}, 20);
  await Bun.sleep(0);
  const aheadController = new AbortController();
  const ahead = download("lookahead", { signal: aheadController.signal }, 1).catch(() => null);
  const foreground = download("focused", {}, 0);
  await Bun.sleep(0);
  expect(starts).toEqual(["thumbnail", "focused"]);
  expect(maximum).toBe(1);
  aheadController.abort();
  active--;
  bodies[1]!.enqueue(new Uint8Array([42]));
  bodies[1]!.close();
  expect(new Uint8Array(await (await foreground).arrayBuffer())).toEqual(new Uint8Array([42]));
  await Bun.sleep(0);
  expect(starts).toEqual(["thumbnail", "focused", "thumbnail"]);
  active--;
  bodies[2]!.close();
  await background;
  await ahead;
  expect(maximum).toBe(1);
});

test("a cancelled foreground releases the worker without retrying it", async () => {
  const starts: string[] = [];
  const download = createImageDownloads(1, (url, { signal }) => {
    starts.push(url);
    if (url === "new-focus") return Promise.resolve(new Response("ready"));
    return new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new Error("cancelled"))));
  });
  const controller = new AbortController();
  const old = download("old-focus", { signal: controller.signal }, 0).catch(() => null);
  controller.abort();
  const next = download("new-focus", {}, 0);
  expect(await (await next).text()).toBe("ready");
  await old;
  expect(starts).toEqual(["old-focus", "new-focus"]);
});

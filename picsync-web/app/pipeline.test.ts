import { expect, test } from "bun:test";
import { Pipeline, type Photo } from "./pipeline";
import { pipelineLimits } from "./pipeline-limits";

test("Apple mobile devices use a two-worker budget, including desktop-mode iPads", () => {
  const iphone = pipelineLimits({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 });
  const ipad = pipelineLimits({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 5 });
  const mac = pipelineLimits({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 0 });
  expect(iphone.workers).toBe(2);
  expect(iphone.downloads).toBe(6);
  expect(iphone.fullCount).toBe(1);
  expect(iphone.prefetchFull).toBe(false);
  expect(ipad).toEqual(iphone);
  expect(mac.workers).toBe(10);
  expect(mac.downloads).toBe(8);
  expect(mac.prefetchFull).toBe(true);
});

test("iPhone admission allows one oversized original without simultaneous large downloads", async () => {
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  const engine = new Pipeline(() => {}, pipelineLimits({ userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 }));
  globalThis.fetch = ((url: string, options: RequestInit) => {
    fetched.push(url);
    return new Promise<Response>((_, reject) => {
      options.signal!.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as typeof fetch;
  try {
    for (let i = 0; i < 4; i++) engine.request({ path: `${i}.ARW`, name: `${i}.ARW`, raw: true, bytes: 256 * 1024 * 1024 }, true);
    expect(fetched).toHaveLength(1);
    expect(engine.activity).toContain("1/6 downloads · 0/2 decoder slots");
  } finally {
    engine.dispose();
    await Promise.resolve();
    globalThis.fetch = originalFetch;
  }
});

test("iPhone preview downloads run six at a time independently of two decoder slots", async () => {
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  const engine = new Pipeline(() => {}, pipelineLimits({ userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 }));
  globalThis.fetch = ((url: string, options: RequestInit) => {
    fetched.push(url);
    return new Promise<Response>((_, reject) => {
      options.signal!.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as typeof fetch;
  try {
    engine.previews(Array.from({ length: 12 }, (_, i) => ({ path: `${i}.ARW`, name: `${i}.ARW`, raw: true, bytes: 37 * 1024 * 1024 })));
    expect(fetched).toHaveLength(6);
    expect(fetched.every((url) => url.startsWith("/api/preview?"))).toBe(true);
    expect(engine.activity).toContain("6/6 downloads · 0/2 decoder slots");
  } finally {
    engine.dispose();
    await Promise.resolve();
    globalThis.fetch = originalFetch;
  }
});

test("viewport changes discard queued previews while sharing active downloads", async () => {
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  const engine = new Pipeline(() => {});
  globalThis.fetch = ((url: string, options: RequestInit) => {
    fetched.push(url);
    return new Promise<Response>((_, reject) => {
      options.signal!.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as typeof fetch;
  const photo = (path: string): Photo => ({ path, name: path, bytes: 1, raw: false });
  try {
    engine.previews(Array.from({ length: 20 }, (_, i) => photo(`${i}.jpg`)));
    expect(fetched).toHaveLength(8);
    engine.previews([photo("19.jpg")]);
    expect(engine.activity).toContain("9 queued");
    // Repeated observer notifications do not download active photos twice.
    engine.previews([photo("0.jpg"), photo("19.jpg")]);
    engine.request(photo("0.jpg"), true, 0);
    expect(fetched).toHaveLength(8);
    engine.previews([]);
    // Eight active previews and the explicitly requested full-resolution job.
    expect(engine.activity).toContain("9 queued");
  } finally {
    engine.dispose();
    await Promise.resolve();
    globalThis.fetch = originalFetch;
  }
});

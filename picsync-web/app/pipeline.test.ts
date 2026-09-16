import { expect, test } from "bun:test";
import { Pipeline, type Photo } from "./pipeline";
import { pipelineLimits as deviceLimits } from "./pipeline-limits";
const pipelineLimits = (device?: Parameters<typeof deviceLimits>[0]) => deviceLimits(device, "browser");

test("server mode eagerly requests rendered full images and cancels obsolete focus lookahead", async () => {
  const originalFetch = globalThis.fetch;
  const fetched: { url: string; signal: AbortSignal }[] = [];
  const limits = deviceLimits({ userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 }, "server");
  const engine = new Pipeline(() => {}, limits, "server");
  globalThis.fetch = ((url: string, options: RequestInit) => {
    fetched.push({ url, signal: options.signal! });
    return new Promise<Response>((_, reject) => {
      options.signal!.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as typeof fetch;
  const photos = Array.from({ length: 20 }, (_, i) => ({ path: `${i}.ARW`, name: `${i}.ARW`, raw: true, bytes: 37 * 1024 * 1024 }));
  try {
    engine.view(photos, 0);
    expect(limits.downloads).toBe(8);
    expect(fetched).toHaveLength(8);
    expect(fetched.every(({ url }) => url.startsWith("/api/render?") && url.includes("size=full"))).toBe(true);
    expect(fetched[0]!.url).toContain("priority=0");
    expect(engine.activity).toContain("11 queued");
    engine.view(photos, null);
    expect(fetched.every(({ signal }) => signal.aborted)).toBe(true);
    await Bun.sleep(0);
    expect(engine.errors.size).toBe(0);
    expect(engine.activity).toContain("0 queued");
  } finally {
    engine.dispose();
    await Promise.resolve();
    globalThis.fetch = originalFetch;
  }
});

test("Apple mobile devices use a one-worker budget, including desktop-mode iPads", () => {
  const iphone = pipelineLimits({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 });
  const ipad = pipelineLimits({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 5 });
  const mac = pipelineLimits({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 0 });
  expect(iphone.workers).toBe(1);
  expect(iphone.downloads).toBe(6);
    expect(iphone.fullCount).toBe(3);
    expect(iphone.prefetchFull).toBe(true);
  expect(ipad).toEqual(iphone);
  expect(mac.workers).toBe(10);
  expect(mac.downloads).toBe(8);
  expect(mac.prefetchFull).toBe(true);
});

test("viewer downloads ten originals ahead and replaces stale lookahead on navigation", async () => {
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  const engine = new Pipeline(() => {}, {
    ...pipelineLimits({ userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 }),
    downloads: 1,
  }, "browser");
  globalThis.fetch = ((url: string, options: RequestInit) => {
    fetched.push(url);
    return new Promise<Response>((_, reject) => {
      options.signal!.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as typeof fetch;
  const photos = Array.from({ length: 18 }, (_, i) => ({ path: `${i}.ARW`, name: `${i}.ARW`, raw: true, bytes: 100 }));
  try {
    engine.view(photos, 0);
    expect(fetched).toEqual(["/api/photo?path=0.ARW"]);
    expect(engine.activity).toContain("11 queued");
    const jobs = (engine as any).jobs as Map<string, { downloadOnly?: boolean }>;
    expect([...jobs.values()].filter(job => !job.downloadOnly)).toHaveLength(3);
    expect(jobs.get("3.ARW:full")?.downloadOnly).toBe(true);
    engine.view(photos, 1);
    expect(jobs.get("3.ARW:full")?.downloadOnly).toBe(false);
    expect(jobs.get("4.ARW:full")?.downloadOnly).toBe(true);
    expect(fetched).toHaveLength(1); // Promotion reuses the queued job.
    engine.view(photos, 15);
    expect(engine.activity).toContain("4 queued"); // Active download plus the new window.
    engine.view(photos, 17);
    expect(engine.activity).toContain("2 queued"); // No wrapping at the end.
    engine.view(photos, null);
    expect(engine.activity).toContain("1 queued"); // Only active work finishes.
  } finally {
    engine.dispose();
    await Promise.resolve();
    globalThis.fetch = originalFetch;
  }
});

test("iPhone admission allows one oversized original without simultaneous large downloads", async () => {
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  const engine = new Pipeline(() => {}, pipelineLimits({ userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 }), "browser");
  globalThis.fetch = ((url: string, options: RequestInit) => {
    fetched.push(url);
    return new Promise<Response>((_, reject) => {
      options.signal!.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as typeof fetch;
  try {
    for (let i = 0; i < 4; i++) engine.request({ path: `${i}.ARW`, name: `${i}.ARW`, raw: true, bytes: 256 * 1024 * 1024 }, true);
    expect(fetched).toHaveLength(1);
    expect(engine.activity).toContain("1/6 downloads · 0/1 decoder slots");
  } finally {
    engine.dispose();
    await Promise.resolve();
    globalThis.fetch = originalFetch;
  }
});

test("iPhone preview downloads run six at a time independently of one decoder slot", async () => {
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  const engine = new Pipeline(() => {}, pipelineLimits({ userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 }), "browser");
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
    expect(engine.activity).toContain("6/6 downloads · 0/1 decoder slots");
  } finally {
    engine.dispose();
    await Promise.resolve();
    globalThis.fetch = originalFetch;
  }
});

test("viewport changes discard queued previews while sharing active downloads", async () => {
  const originalFetch = globalThis.fetch;
  const fetched: string[] = [];
  const engine = new Pipeline(() => {}, pipelineLimits(), "browser");
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

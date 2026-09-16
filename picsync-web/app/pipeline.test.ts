import { expect, test } from "bun:test";
import { Pipeline, type Photo } from "./pipeline";

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

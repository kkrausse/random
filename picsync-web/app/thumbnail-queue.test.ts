import { expect, test } from "bun:test";
import { createThumbnailQueue } from "./thumbnail-queue";

test("a distant viewport bypasses cancelled active and queued thumbnails", async () => {
  const started: string[] = [];
  const signals: AbortSignal[] = [];
  const completed: string[] = [];
  const releases: (() => void)[] = [];
  const download = (url: string, options: RequestInit) => {
    started.push(new URL(url, "http://localhost").searchParams.get("path")!);
    signals.push(options.signal!);
    // Deliberately finish after abort to exercise the late-response race too.
    return new Promise<Response>(resolve => {
      releases.push(() => resolve(new Response("jpeg")));
    });
  };
  const queue = createThumbnailQueue(2, download);
  const request = (path: string) => queue.request(path,
    () => completed.push(path), () => completed.push(`error:${path}`));
  const cancel = [request("old-1"), request("old-2"), request("old-queued")];
  await Bun.sleep(0);
  expect(started).toEqual(["old-1", "old-2"]);
  cancel.forEach(stop => stop());
  request("destination");
  expect(signals.every(signal => signal.aborted)).toBe(true);
  releases[0]!();
  releases[1]!();
  await Bun.sleep(0);
  expect(started).toEqual(["old-1", "old-2", "destination"]);
  expect(completed).toEqual([]);
  releases[2]!();
  await Bun.sleep(0);
  expect(completed).toEqual(["destination"]);
});

test("failed downloads release capacity and report errors only for live tiles", async () => {
  const results: string[] = [];
  let count = 0;
  const queue = createThumbnailQueue(1, async () => {
    if (++count === 1) throw new Error("network failed");
    return new Response("jpeg");
  });
  queue.request("broken", () => results.push("unexpected"), () => results.push("failed"));
  queue.request("next", () => results.push("loaded"), () => results.push("unexpected"));
  await Bun.sleep(0);
  expect(results).toEqual(["failed", "loaded"]);
});

test("visible thumbnails precede lookahead and queued distances update after scrolling", async () => {
  const started: string[] = [];
  const finish: (() => void)[] = [];
  const queue = createThumbnailQueue(1, async url => {
    started.push(new URL(url, "http://localhost").searchParams.get("path")!);
    return new Promise<Response>(resolve => finish.push(() => resolve(new Response("jpeg"))));
  });
  let distance = 500;
  const cancel = [
    queue.request("lookahead", () => {}, () => {}, () => distance),
    queue.request("visible", () => {}, () => {}, () => 0),
    queue.request("nearby", () => {}, () => {}, () => 100),
  ];
  await Bun.sleep(0);
  expect(started).toEqual(["visible"]);
  distance = 0;
  finish[0]!();
  await Bun.sleep(0);
  expect(started).toEqual(["visible", "lookahead"]);
  cancel.forEach(stop => stop());
  finish[1]!();
  await Bun.sleep(0);
  expect(started).toHaveLength(2);
});

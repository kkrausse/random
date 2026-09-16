// Run with Browser Control against a disposable gallery fixture containing
// a "Test album" folder with twelve supported RAW originals (Photo 1.ARW, etc.).
// Set state.verifyIOS = true in a fresh session to exercise the iOS budget in
// Chromium. This verifies scheduling, not Safari's actual memory ceiling.
const ios = state.verifyIOS === true;
await page.addInitScript((ios) => {
  if (ios) {
    Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)" });
    Object.defineProperty(navigator, "platform", { get: () => "iPhone" });
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
  }
  if (window.galleryMetrics) return;
  window.galleryMetrics = { active: 0, peak: 0, created: 0, downloads: {}, previews: {}, jobs: [] };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.stopped = false;
      window.galleryMetrics.active++;
      window.galleryMetrics.created++;
      window.galleryMetrics.peak = Math.max(
        window.galleryMetrics.peak,
        window.galleryMetrics.active,
      );
    }
    terminate() {
      if (!this.stopped) {
        this.stopped = true;
        window.galleryMetrics.active--;
      }
      return super.terminate();
    }
    postMessage(data, ...rest) {
      if (data.type !== "init") window.galleryMetrics.jobs.push({ halfSize: data.halfSize, count: data.count });
      return super.postMessage(data, ...rest);
    }
  };
  const nativeFetch = window.fetch;
  window.fetch = (...args) => {
    const url = String(args[0]);
    if (url.startsWith("/api/photo"))
      window.galleryMetrics.downloads[url] =
        (window.galleryMetrics.downloads[url] || 0) + 1;
    if (url.startsWith("/api/preview"))
      window.galleryMetrics.previews[url] = (window.galleryMetrics.previews[url] || 0) + 1;
    return nativeFetch(...args);
  };
}, ios);
await page.setViewportSize({ width: 390, height: 844 });
// Sign in to the fixture first. Reload preserves same-origin fetch metadata
// when Browser Control is driving a cross-origin-isolated page.
await page.reload();
await page.getByRole("button", { name: "Test album", exact: true }).waitFor();
await page.getByRole("button", { name: "Test album", exact: true }).click();
await page.locator(".tile").first().locator("img").waitFor({ timeout: 120000 });
const gridMetrics = await page.evaluate(() => window.galleryMetrics);
if (gridMetrics.created !== (ios ? 1 : 2) || gridMetrics.jobs.length !== 0 || Object.keys(gridMetrics.downloads).length !== 0)
  throw new Error("Expected eager worker initialization but no RAW jobs or originals for embedded thumbnails");
await page
  .getByRole("button", { name: "Open Photo 1.ARW", exact: true })
  .click();
await page.waitForFunction(
  () => document.querySelector("canvas.full-photo")?.width > 1000,
  { timeout: 120000 },
);
const dimensions = await page
  .locator(".full-photo")
  .evaluate((el) => [el.width, el.height]);
await page.locator(".stage").dblclick();
const pixelZoom = await page
  .locator(".full-photo")
  .evaluate((el) => el.style.transform);
await page.mouse.move(180, 360);
await page.mouse.down();
await page.mouse.move(240, 420, { steps: 6 });
await page.mouse.up();
const dragged = await page
  .locator(".full-photo")
  .evaluate((el) => el.style.transform);
if (dragged === pixelZoom)
  throw new Error("Click-drag did not pan the zoomed photo");
await page.locator(".stage").dblclick();
// Real Chromium touch input exercises the two-pointer pinch-to-grid path.
const cdp = await context.newCDPSession(page);
await cdp.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [
    { x: 100, y: 380, id: 1 },
    { x: 290, y: 380, id: 2 },
  ],
});
await cdp.send("Input.dispatchTouchEvent", {
  type: "touchMove",
  touchPoints: [
    { x: 145, y: 380, id: 1 },
    { x: 245, y: 380, id: 2 },
  ],
});
await cdp.send("Input.dispatchTouchEvent", {
  type: "touchEnd",
  touchPoints: [],
});
await page.getByRole("dialog").waitFor({ state: "detached" });
// The smaller iOS preload margin intentionally leaves lower rows unloaded.
for (let i = 0; i < 12; i++) {
  const tile = page.locator(".tile").nth(i);
  await tile.scrollIntoViewIfNeeded();
  await tile.locator("img").waitFor({ timeout: 120000 });
}
await page.waitForFunction(
  () => document.querySelectorAll(".tile img").length === 12,
  { timeout: 120000 },
);
const metrics = await page.evaluate(() => window.galleryMetrics);
const workerLimit = ios ? 1 : 2;
if (metrics.peak > workerLimit || metrics.created > workerLimit || metrics.active === 0)
  throw new Error(`Worker lifecycle failed: ${JSON.stringify(metrics)}`);
if (metrics.jobs.some((job) => job.count !== 1))
  throw new Error("Expected one worker per image");
if (metrics.jobs.some((job) => job.halfSize))
  throw new Error("Embedded thumbnails should not use RAW workers");
if (Object.keys(metrics.previews).length !== 12 || Object.values(metrics.previews).some((n) => n !== 1))
  throw new Error("Expected one embedded-preview download per photo");
if (metrics.jobs.filter((job) => !job.halfSize).length > 3)
  throw new Error("Viewer should only develop the opened photo and two upcoming photos");
if (Object.values(metrics.downloads).some((n) => n !== 1))
  throw new Error(
    "Original downloaded more than once during thumbnail/full upgrade",
  );
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > innerWidth,
);
if (overflow) throw new Error("Mobile layout overflows");
const previews = await page.locator(".tile img").count();
const thumbnailSizes = await page.locator(".tile img").evaluateAll((images) =>
  images.map((image) => [image.naturalWidth, image.naturalHeight]));
if (thumbnailSizes.some(([width, height]) => width < 1 || height < 1 || Math.max(width, height) > 320))
  throw new Error(`Unexpected thumbnail dimensions: ${JSON.stringify(thumbnailSizes)}`);
await page.getByRole("button", { name: "Archive", exact: true }).click();
await page.getByRole("button", { name: "Test album", exact: true }).waitFor();
const afterFolderChange = await page.evaluate(() => window.galleryMetrics);
if (afterFolderChange.active !== workerLimit || afterFolderChange.created !== workerLimit)
  throw new Error("Folder navigation must retain the initialized worker pool");
await cdp.detach();
return {
  profile: ios ? "iOS (Chromium simulation)" : "desktop",
  dimensions,
  pixelZoom,
  dragged,
  metrics,
  overflow,
  photos: previews,
  thumbnailSizes,
};

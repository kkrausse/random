// Verification harness (diesel2 only): own Xvfb (:108) + headed Chrome with a fake camera from a
// y4m (e.g. ffmpeg -i face.mp4 -t 8 -pix_fmt yuv420p face.y4m) against a running gaze server.
// usage: bun tools/drive.ts <video.y4m> <outdir> [probe|full] [url]
//   url defaults to http://127.0.0.1:4842/ (the server's own copy of dist/); pass the
//   tailnet https URL or the deployed artifact to test those.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const [y4m, out, mode = "probe", url = "http://127.0.0.1:4842/"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const xvfb = Bun.spawn(["Xvfb", ":108", "-screen", "0", "1512x982x24", "-nolisten", "tcp"], { stderr: "ignore" });
await Bun.sleep(800);
rmSync("/tmp/it-prof", { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext("/tmp/it-prof", {
  executablePath: "/usr/bin/google-chrome", headless: false, viewport: null,
  env: { ...process.env, DISPLAY: ":108" },
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--no-first-run", "--window-size=1512,982", "--start-fullscreen",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`],
});
const logs: string[] = [];
try {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 400)));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(url);
  await page.fill("#screenCm", "30.2");
  const t0 = Date.now();
  await page.click("#start");
  await page.waitForFunction(() => /fps/.test(document.querySelector("#hud")!.textContent!) && (window as any).__it.dump()?.crops, null, { timeout: 60000, polling: 500 });
  console.log(`first result with crops after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.waitForTimeout(4000);
  console.log("hud:", await page.textContent("#hud"));
  const d = await page.evaluate(() => (window as any).__it.dump());
  const b64 = (u: string) => Buffer.from(u.split(",")[1], "base64");
  writeFileSync(`${out}/frame.png`, b64(d.frame));
  writeFileSync(`${out}/crops.jpg`, b64(d.crops));
  writeFileSync(`${out}/dump.json`, JSON.stringify({ ...d, frame: undefined, crops: undefined }, null, 1));
  console.log("dump:", JSON.stringify({ gaze: d.gaze, face: d.face, grid: d.grid, ms: d.ms, stats: d.stats, hello: d.hello }));
  await page.screenshot({ path: `${out}/running.png` });
  if (mode === "full") {
    await page.waitForFunction(() => (window as any).__itReport, null, { timeout: 240000, polling: 1000 });
    const full = await page.evaluate(() => (window as any).__itReport);
    writeFileSync(`${out}/report-full.json`, JSON.stringify(full));
    const rep = { ...full, frames: undefined, raw: undefined, nFrames: Object.fromEntries(Object.entries(full.frames).map(([k, v]) => [k, (v as unknown[]).length])) };
    writeFileSync(`${out}/report.json`, JSON.stringify(rep, null, 1));
    console.log("report:", JSON.stringify({ uncal: rep.uncalibrated, cal: rep.calibrated, loo: rep.leaveOneDotOutCm, rtt: rep.roundTripMsMedian, server: rep.serverMsMedian, fps: rep.framesPerSecondWhileRecording, nFrames: rep.nFrames }));
    await page.screenshot({ path: `${out}/results.png` });
  }
} catch (e) {
  console.log("ERROR", e);
} finally {
  writeFileSync(`${out}/console.log`, logs.join("\n"));
  console.log(logs.filter((l) => /error|warn/i.test(l)).slice(0, 15).join("\n"));
  await ctx.close();
  xvfb.kill();
}

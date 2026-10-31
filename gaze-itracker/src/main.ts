// Gaze lab · iTracker (GazeCapture, CVPR 2016). Same 12-dot test -> 9-dot calibration -> 12-dot
// test flow and report as the UniGaze and WebEyeTrack pages, so the numbers compare directly.
// Inference runs on diesel2 (server/server.py); this page only captures and streams frames.
import { connect, type Frame, type Remote } from "./remote";
import { apply, fitAll, uncalibrated, type Fit, type Geometry, type Pt } from "./calib";

interface PointStat {
  target: Pt;
  mean: Pt | null;
  n: number;
  accPx: number;
  precPx: number;
}
interface Rec { f: Frame; target: Pt; dot: number }

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const video = $<HTMLVideoElement>("#video");
const view = $<HTMLCanvasElement>("#view");
const cropImg = $<HTMLImageElement>("#crop");
const dot = $<HTMLDivElement>("#dot");
const gaze = $<HTMLDivElement>("#gaze");
const hud = $<HTMLDivElement>("#hud");
const setup = $<HTMLDivElement>("#setup");
const results = $<HTMLDivElement>("#results");
const msg = $<HTMLDivElement>("#msg");

const params = new URLSearchParams(location.search);
const lowRes = params.get("res") === "480";
const camAboveTopMm = Number(params.get("cam") ?? 10);
const jpegQ = Number(params.get("q") ?? 0.8);
// Same origin when served by the gaze server itself; otherwise diesel2's tailnet endpoint.
const wsUrl = params.get("ws") ?? (location.port === "4842" ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws` : "wss://diesel2.guineafowl-truck.ts.net:4842/ws");

// MacBook logical widths -> physical display width in cm, used as the default guess.
const knownWidths: Record<number, number> = { 1470: 28.7, 1512: 30.2, 1710: 33.0, 1728: 34.5, 1440: 28.6, 1280: 28.6 };
$<HTMLInputElement>("#screenCm").value = String(knownWidths[screen.width] ?? 30.2);

let remote: Remote;
let latest: Frame | null = null;
let recorder: ((f: Frame) => void) | null = null;
let mapper: (f: Frame) => Pt | null = () => null;
let frames = 0;
let distCm = 55;
let geo: Geometry;
const lat: number[] = [];
const rtt: number[] = [];

function draw(f: Frame | null) {
  const fc = remote.frameCanvas;
  if (!fc.width) return;
  const vctx = view.getContext("2d")!;
  view.width = 240;
  view.height = Math.round((240 * fc.height) / fc.width);
  const s = view.width / fc.width;
  vctx.drawImage(fc, 0, 0, view.width, view.height);
  if (remote.crops && cropImg.src !== remote.crops) cropImg.src = remote.crops;
  if (!f) return;
  // Boxes are from the server's frame, which may be a frame or two older than this canvas.
  const [x, y, w, h] = f.face;
  vctx.lineWidth = 1.5;
  vctx.strokeStyle = "#a3e635";
  vctx.strokeRect(x * s, y * s, w * s, h * s);
  vctx.strokeStyle = "#38bdf8";
  for (const e of [f.eyeL, f.eyeR]) vctx.strokeRect((x + e[0]) * s, (y + e[1]) * s, e[2] * s, e[3] * s);
}

function arrow(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number) {
  c.strokeStyle = "#a3e635";
  c.fillStyle = "#a3e635";
  c.lineWidth = w;
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  const ang = Math.atan2(y1 - y0, x1 - x0), L = 6 + 3 * w;
  c.beginPath(); c.moveTo(x1, y1);
  c.lineTo(x1 - L * Math.cos(ang - 0.45), y1 - L * Math.sin(ang - 0.45));
  c.lineTo(x1 - L * Math.cos(ang + 0.45), y1 - L * Math.sin(ang + 0.45));
  c.fill();
}

const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0);
setInterval(() => {
  if (!remote) return;
  hud.textContent = `${frames} fps · ${video.videoWidth}×${video.videoHeight} JPEG q${jpegQ} · ${remote.hello.gpu} · round trip ${med(rtt).toFixed(0)} ms (model ${med(lat).toFixed(1)} ms)` +
    (latest ? ` · gaze ${latest.gaze.map((v) => v.toFixed(1)).join(", ")} cm` : "");
  frames = 0;
  lat.length = 0;
  rtt.length = 0;
}, 1000);

function onFrame(f: Frame | null) {
  latest = f;
  if (f) {
    frames++;
    lat.push(f.ms.model);
    rtt.push(f.ms.rtt);
    const p = mapper(f);
    if (p) {
      gaze.style.transform = `translate(${p[0]}px, ${p[1]}px)`;
      gaze.style.opacity = "1";
    }
    (f.tag as ((f: Frame) => void) | null)?.(f);
  } else gaze.style.opacity = "0.25";
  draw(f);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function showDot(p: Pt, during: (on: boolean) => void) {
  const [x, y] = [p[0] * innerWidth, p[1] * innerHeight];
  dot.style.transition = "none";
  dot.style.transform = `translate(${x}px, ${y}px) scale(3)`;
  dot.style.opacity = "1";
  await sleep(30);
  dot.style.transition = "transform 600ms ease-out";
  dot.style.transform = `translate(${x}px, ${y}px) scale(1)`;
  await sleep(700);
  during(true);
  await sleep(1000);
  during(false);
  dot.style.opacity = "0";
  await sleep(150);
}

const calibPts: Pt[] = [0.08, 0.5, 0.92].flatMap((y) => [0.06, 0.5, 0.94].map((x) => [x, y] as Pt));
const testPts: Pt[] = shuffle([0.2, 0.5, 0.8].flatMap((y) => [0.15, 0.38, 0.62, 0.85].map((x) => [x, y] as Pt)));

function shuffle<T>(a: T[]): T[] {
  return a.map((v) => [Math.random(), v] as const).sort((p, q) => p[0] - q[0]).map(([, v]) => v);
}

// Show each dot and keep every face frame recorded while it is fixated.
async function collect(label: string, pts: Pt[]): Promise<Rec[]> {
  msg.textContent = label;
  await sleep(1200);
  msg.textContent = "";
  const recs: Rec[] = [];
  for (const [i, t] of pts.entries()) {
    const tp: Pt = [t[0] * innerWidth, t[1] * innerHeight];
    await showDot(t, (on) => (recorder = on ? (f) => recs.push({ f, target: tp, dot: i }) : null));
  }
  return recs;
}

function stats(recs: Rec[], pts: Pt[], map: (f: Frame) => Pt | null): PointStat[] {
  return pts.map((t, i) => {
    const mine = recs.filter((r) => r.dot === i);
    const tp: Pt = [t[0] * innerWidth, t[1] * innerHeight];
    const got = mine.map((r) => map(r.f)).filter((p): p is Pt => !!p);
    if (!got.length) return { target: tp, mean: null, n: 0, accPx: NaN, precPx: NaN };
    const m: Pt = [avg(got.map((p) => p[0])), avg(got.map((p) => p[1]))];
    return {
      target: tp,
      mean: m,
      n: got.length,
      accPx: Math.hypot(m[0] - tp[0], m[1] - tp[1]),
      precPx: Math.sqrt(avg(got.map((p) => (p[0] - m[0]) ** 2 + (p[1] - m[1]) ** 2))),
    };
  });
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function summarize(st: PointStat[], pxPerCm: number) {
  const ok = st.filter((s) => s.mean);
  const cm = (px: number) => px / pxPerCm;
  const deg = (px: number) => (Math.atan(cm(px) / distCm) * 180) / Math.PI;
  const acc = ok.map((s) => s.accPx);
  const prec = ok.map((s) => s.precPx);
  return {
    points: `${ok.length}/${testPts.length}`,
    meanAccCm: cm(avg(acc)),
    meanAccDeg: deg(avg(acc)),
    medianAccCm: cm(median(acc)),
    medianAccDeg: deg(median(acc)),
    precisionCm: cm(avg(prec)),
    precisionDeg: deg(avg(prec)),
    framesPerPoint: avg(ok.map((s) => s.n)),
  };
}

function plot(st: PointStat[], color: string) {
  return st
    .filter((s) => s.mean)
    .map(
      (s) =>
        `<line x1="${s.target[0]}" y1="${s.target[1]}" x2="${s.mean![0]}" y2="${s.mean![1]}" stroke="${color}" stroke-width="3"/>` +
        `<circle cx="${s.mean![0]}" cy="${s.mean![1]}" r="${Math.max(6, s.precPx)}" fill="${color}" fill-opacity="0.25" stroke="${color}"/>` +
        `<circle cx="${s.target[0]}" cy="${s.target[1]}" r="6" fill="#fff"/>`,
    )
    .join("");
}

// Compact per-frame record for the JSON export (enough to refit offline).
const slim = (r: Rec) => ({
  dot: r.dot, target: r.target.map(Math.round), t: Math.round(r.f.t), gazeCm: r.f.gaze.map((v) => +v.toFixed(3)),
  face: r.f.face.map((v) => +v.toFixed(1)), eyeL: r.f.eyeL.map((v) => +v.toFixed(1)), eyeR: r.f.eyeR.map((v) => +v.toFixed(1)),
  grid: r.f.grid, lm: r.f.lm, rttMs: +r.f.ms.rtt.toFixed(1), modelMs: +r.f.ms.model.toFixed(2),
});

function showResults(before: Rec[], calib: Rec[], after: Rec[], fits: Fit[], best: Fit, pxPerCm: number) {
  const n = testPts;
  const uncal = (f: Frame) => uncalibrated(f, geo);
  const sBefore = stats(before, n, uncal);
  const sAfter = stats(after, n, (f) => apply(best, f));
  const cols: { label: string; st: PointStat[] }[] = [
    { label: "Uncalibrated", st: sBefore },
    { label: `Calibrated (${best.name})`, st: sAfter },
    ...fits.filter((f) => f !== best).map((f) => ({ label: f.name, st: stats(after, n, (fr) => apply(f, fr)) })),
    { label: "test 2, uncal.", st: stats(after, n, uncal) },
  ];
  const sums = cols.map((c) => summarize(c.st, pxPerCm));
  const row = (k: string, f: (s: (typeof sums)[0]) => string) => `<tr><td>${k}</td>${sums.map((s) => `<td>${f(s)}</td>`).join("")}</tr>`;
  const f1 = (x: number) => x.toFixed(1);
  const f2 = (x: number) => x.toFixed(2);
  const all = [...before, ...calib, ...after];
  const msMedian = median(all.map((r) => r.f.ms.model));
  const rttMedian = median(all.map((r) => r.f.ms.rtt));
  const fpsMean = all.length / (2 * testPts.length + calibPts.length); // frames per 1 s recording window
  const report = {
    tracker: `iTracker (GazeCapture PyTorch checkpoint) on ${remote.hello.gpu} + 9-dot ${best.name} ridge calibration`,
    camera: `${video.videoWidth}x${video.videoHeight}`,
    screen: `${innerWidth}x${innerHeight} css px, ${(innerWidth / pxPerCm).toFixed(1)} cm wide`,
    distanceCm: distCm,
    camAboveTopMm,
    jpegQuality: jpegQ,
    server: wsUrl,
    calibrationFrames: calib.length,
    modelMsMedian: +msMedian.toFixed(1),
    roundTripMsMedian: +rttMedian.toFixed(1),
    serverMsMedian: Object.fromEntries((["decode", "landmarks", "model", "total"] as const).map((k) => [k, +median(all.map((r) => r.f.ms[k])).toFixed(1)])),
    framesPerSecondWhileRecording: +fpsMean.toFixed(1),
    leaveOneDotOutCm: Object.fromEntries(fits.map((f) => [f.name, +f.looCm.toFixed(2)])),
    uncalibrated: sums[0],
    calibrated: sums[1],
    others: Object.fromEntries(cols.slice(2).map((c, i) => [c.label, sums[i + 2]])),
    raw: { before: sBefore, after: sAfter },
    frames: { before: before.map(slim), calib: calib.map(slim), after: after.map(slim) },
  };
  console.log(report);
  (window as any).__itReport = report;
  results.innerHTML = `
    <svg width="${innerWidth}" height="${innerHeight}" style="position:fixed;inset:0;pointer-events:none">
      ${plot(sBefore, "#f97316")}${plot(sAfter, "#22c55e")}
    </svg>
    <div class="card wide">
      <h2>iTracker results</h2>
      <p class="sub">Lines go from each white target to the mean gaze estimate. <b style="color:#f97316">orange</b> = before calibration, <b style="color:#22c55e">green</b> = after (${best.name} mapping, picked by leave-one-dot-out error). Circle radius = jitter. Extra columns re-score test 2 with the other mappings.</p>
      <p class="sub">The uncalibrated column uses iTracker's raw output (cm on the camera plane) with the camera assumed ${camAboveTopMm} mm above the screen. iTracker was trained on iPhones and iPads held at about 30 cm, with a different camera and Apple's face/eye detector; at ${distCm} cm on a laptop with MediaPipe-derived crops, expect the uncalibrated error to suffer. The calibrated columns absorb a scale and offset.</p>
      <table>
        <tr><th></th>${cols.map((c) => `<th>${c.label}</th>`).join("")}</tr>
        ${row("points tracked", (s) => s.points)}
        ${row("median accuracy", (s) => `${f1(s.medianAccCm)} cm · ${f1(s.medianAccDeg)}°`)}
        ${row("mean accuracy", (s) => `${f1(s.meanAccCm)} cm · ${f1(s.meanAccDeg)}°`)}
        ${row("jitter (precision)", (s) => `${f2(s.precisionCm)} cm · ${f2(s.precisionDeg)}°`)}
        ${row("frames per point", (s) => f1(s.framesPerPoint))}
      </table>
      <p class="sub">${report.camera} camera · ${remote.hello.gpu} · round trip ${f1(rttMedian)} ms · ${f1(fpsMean)} frames/s · model ${f1(msMedian)} ms/frame · ${calib.length} calibration frames · leave-one-dot-out ${fits.map((f) => `${f.name} ${f2(f.looCm)} cm`).join(", ")} · ${distCm} cm viewing distance assumed</p>
      <div class="buttons">
        <button id="free">Free look</button>
        <button id="copy">Copy JSON</button>
        <button onclick="location.reload()">Start over</button>
      </div>
    </div>`;
  results.style.display = "block";
  $("#copy").onclick = () => navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  $("#free").onclick = () => {
    results.style.display = "none";
    $("#freelook").style.display = "block";
  };
}

$("#start").onclick = async () => {
  distCm = Number($<HTMLInputElement>("#distCm").value) || 55;
  const screenCm = Number($<HTMLInputElement>("#screenCm").value) || 30.2;
  setup.style.display = "none";
  await document.documentElement.requestFullscreen?.().catch(() => {});
  msg.textContent = "Starting camera…";
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: lowRes ? 640 : 1280 }, height: { ideal: lowRes ? 480 : 720 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  try {
    remote = await connect({ url: wsUrl, video, quality: jpegQ, tag: () => recorder, onFrame, onStatus: (s) => (msg.textContent = s) });
  } catch (e) {
    msg.textContent = `Failed to reach the gaze server: ${(e as Error).message ?? e}`;
    throw e;
  }
  const pxPerCm = screen.width / screenCm;
  geo = { pxPerMm: pxPerCm / 10, camAboveTopMm, viewportW: innerWidth };
  mapper = (f) => uncalibrated(f, geo);
  msg.textContent = "Sit how you normally do and keep your head roughly still";
  await sleep(2500);
  const before = await collect("Test 1 (uncalibrated): look at each dot until it disappears", testPts);
  const calib = await collect("Calibration: look at the centre of each dot", calibPts);
  msg.textContent = "Fitting…";
  const fits = fitAll(calib, pxPerCm);
  const best = fits.reduce((a, b) => (b.looCm < a.looCm ? b : a));
  mapper = (f) => apply(best, f);
  msg.textContent = "";
  const after = await collect("Test 2 (calibrated): look at each dot until it disappears", testPts);
  showResults(before, calib, after, fits, best, pxPerCm);
};

// Debug hook for automated checks: the last result plus images.
(window as any).__it = {
  dump: () => latest && { ...latest, tag: undefined, frame: remote.frameCanvas.toDataURL("image/png"), crops: remote.crops, stats: remote.stats, hello: remote.hello },
};

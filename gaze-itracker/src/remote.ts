// Remote tracker: camera frames go to the diesel2 gaze server as JPEG over a WebSocket
// (server/server.py), which runs MediaPipe + iTracker (PyTorch, CUDA) and returns gaze in cm
// on the camera plane. Up to MAX_IN_FLIGHT frames are pipelined so throughput is not capped
// by the round trip.

export interface Frame {
  seq: number;
  t: number; // capture time (performance.now)
  gaze: [number, number]; // iTracker output: cm from the camera, x to the user's right, y up
  face: [number, number, number, number]; // Apple-style face box, frame px
  eyeL: [number, number, number, number]; // relative to the face box
  eyeR: [number, number, number, number];
  grid: [number, number, number, number]; // face grid params (1-based x, y, w, h in 25x25)
  lm: [number, number][]; // eye corners, nose tip, chin (frame px)
  W: number;
  H: number;
  ms: { rtt: number; encode: number; decode: number; landmarks: number; model: number; total: number };
  tag: unknown; // whatever the caller attached when the frame was captured
}

export interface Remote {
  hello: { model: string; device: string; gpu: string };
  stop(): void;
  crops: string | null; // last crop strip (data URL): face | subject's left eye | right eye
  frameCanvas: HTMLCanvasElement; // last frame sent
  stats: { sent: number; got: number; noFace: number };
}

const MAX_IN_FLIGHT = 2;

export async function connect(opts: {
  url: string;
  video: HTMLVideoElement;
  quality: number;
  tag: () => unknown; // read at capture time, returned with the result
  onFrame: (f: Frame | null) => void;
  onStatus: (s: string) => void;
}): Promise<Remote> {
  opts.onStatus(`Connecting to ${opts.url}…`);
  const ws = new WebSocket(opts.url);
  ws.binaryType = "arraybuffer";
  const hello = await new Promise<Remote["hello"]>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`no answer from ${opts.url} after 15 s`)), 15000);
    ws.onerror = () => { clearTimeout(t); rej(new Error(`could not connect to ${opts.url} (is the gaze-itracker server running, and are you on the tailnet?)`)); };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      clearTimeout(t);
      if (m.error) rej(new Error(m.error));
      else res(m.hello);
    };
  });
  const frameCanvas = document.createElement("canvas");
  const ctx = frameCanvas.getContext("2d")!;
  const pending = new Map<number, { t: number; encode: number; tag: unknown }>();
  const r: Remote = { hello, stop, crops: null, frameCanvas, stats: { sent: 0, got: 0, noFace: 0 } };
  let seq = 0;
  let stopped = false;
  let lastVideoTime = -1;

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const p = pending.get(m.seq);
    pending.delete(m.seq);
    r.stats.got++;
    if (m.crops) r.crops = m.crops;
    if (!p) return;
    if (!m.ok) { r.stats.noFace++; opts.onFrame(null); return; }
    const rtt = performance.now() - p.t;
    opts.onFrame({ ...m, t: p.t, tag: p.tag, ms: { ...m.ms, rtt, encode: p.encode } });
    pump();
  };
  ws.onclose = () => { if (!stopped) opts.onStatus("Connection to the gaze server closed. Reload to reconnect."); };

  let busy = false;
  async function pump() {
    if (busy || stopped || pending.size >= MAX_IN_FLIGHT || ws.readyState !== WebSocket.OPEN) return;
    const v = opts.video;
    if (v.readyState < 2 || v.currentTime === lastVideoTime) return;
    busy = true;
    lastVideoTime = v.currentTime;
    const t = performance.now();
    if (frameCanvas.width !== v.videoWidth) { frameCanvas.width = v.videoWidth; frameCanvas.height = v.videoHeight; }
    ctx.drawImage(v, 0, 0);
    const tag = opts.tag();
    const blob = await new Promise<Blob>((res) => frameCanvas.toBlob((b) => res(b!), "image/jpeg", opts.quality));
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    const msg = new Uint8Array(8 + jpeg.length);
    const dv = new DataView(msg.buffer);
    const s = ++seq;
    dv.setUint32(0, s, true);
    dv.setUint32(4, s % 10 === 0 ? 1 : 0, true); // crops for the corner preview every 10th frame
    msg.set(jpeg, 8);
    pending.set(s, { t, encode: performance.now() - t, tag });
    ws.send(msg);
    r.stats.sent++;
    busy = false;
    pump();
  }
  // New camera frames drive capture; results free a slot and pump again.
  const onVideoFrame = () => { pump(); if (!stopped) opts.video.requestVideoFrameCallback(onVideoFrame); };
  opts.video.requestVideoFrameCallback(onVideoFrame);
  // Drop frames that never come back (e.g. server restarted) so the pipeline cannot stall.
  const sweep = setInterval(() => {
    const now = performance.now();
    for (const [k, p] of pending) if (now - p.t > 3000) pending.delete(k);
    pump();
  }, 500);

  function stop() { stopped = true; clearInterval(sweep); ws.close(); }
  return r;
}

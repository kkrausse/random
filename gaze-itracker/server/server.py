"""Gaze inference server for the gaze-lab pages (diesel2, RTX 2080 Ti).

The browser sends camera frames as JPEG over a WebSocket; the server runs MediaPipe Face
Landmarker (CPU) and a PyTorch gaze model (CUDA) and sends the result back as JSON.
Also serves the built page (../dist) so one tailnet HTTPS origin covers both.

Binds 127.0.0.1 only; `tailscale serve --https=PORT http://127.0.0.1:PORT` exposes it to the
tailnet.

Protocol (one WebSocket per page, /ws?model=itracker):
  client -> server: binary = 8-byte header (uint32 seq, uint32 flags, little endian) + JPEG.
                    flags & 1: also return the model's input crops as a JPEG data URL.
  server -> client: text JSON {seq, ok, gaze, face, eyeL, eyeR, grid, lm, W, H, ms{decode,
                    landmarks, model, total}, crops?} or {seq, ok: false} when no face.
  First message from the server: {hello: {model, device, gpu}}.
"""
import argparse
import asyncio
import base64
import json
import os
import struct
import time
from concurrent.futures import ThreadPoolExecutor

import cv2
import mediapipe as mp
import numpy as np
import torch
from aiohttp import web, WSMsgType
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision

import models

HERE = os.path.dirname(os.path.abspath(__file__))
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
_models = {}
# One worker thread: the GPU and the CPU landmarker are shared; frames queue up behind it.
pool = ThreadPoolExecutor(max_workers=1)


def get_model(name):
    if name not in _models:
        _models[name] = models.load(name, DEVICE)
    return _models[name]


def new_landmarker():
    return vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=os.path.join(models.ASSETS, "face_landmarker.task")),
        running_mode=vision.RunningMode.VIDEO, num_faces=1))


def strip(crops):
    s = np.concatenate(crops, axis=1)
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(s, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 85])
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode()


def process(state, jpeg, flags):
    t0 = time.perf_counter()
    bgr = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    t1 = time.perf_counter()
    ts = max(state["ts"] + 1, int(time.monotonic() * 1000))
    state["ts"] = ts
    res = state["lmk"].detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), ts)
    t2 = time.perf_counter()
    H, W = rgb.shape[:2]
    if not res.face_landmarks:
        return {"ok": False, "W": W, "H": H, "ms": {"decode": (t1 - t0) * 1e3, "landmarks": (t2 - t1) * 1e3}}
    lm = np.array([[p.x * W, p.y * H] for p in res.face_landmarks[0]], np.float32)
    out = state["predict"](rgb, lm)
    if DEVICE == "cuda":
        torch.cuda.synchronize()
    t3 = time.perf_counter()
    crops = out.pop("crops", None)
    out.update(ok=True, W=W, H=H, lm=[[round(float(v), 1) for v in lm[i]] for i in (33, 133, 362, 263, 1, 152)],
               ms={"decode": (t1 - t0) * 1e3, "landmarks": (t2 - t1) * 1e3, "model": (t3 - t2) * 1e3, "total": (t3 - t0) * 1e3})
    if flags & 1 and crops is not None:
        out["crops"] = strip(crops)
    return out


async def ws_handler(request):
    ws = web.WebSocketResponse(max_msg_size=8 << 20, compress=False)
    await ws.prepare(request)
    name = request.query.get("model", "itracker")
    loop = asyncio.get_running_loop()
    try:
        predict = await loop.run_in_executor(pool, get_model, name)
        lmk = await loop.run_in_executor(pool, new_landmarker)
    except Exception as e:  # unknown model, missing assets
        await ws.send_json({"error": f"{type(e).__name__}: {e}"})
        await ws.close()
        return ws
    state = {"predict": predict, "lmk": lmk, "ts": 0}
    gpu = torch.cuda.get_device_name(0) if DEVICE == "cuda" else "cpu"
    await ws.send_json({"hello": {"model": name, "device": DEVICE, "gpu": gpu}})
    print(f"connect {request.remote} model={name}", flush=True)
    try:
        async for msg in ws:
            if msg.type != WSMsgType.BINARY:
                continue
            seq, flags = struct.unpack_from("<II", msg.data)
            out = await loop.run_in_executor(pool, process, state, msg.data[8:], flags)
            out["seq"] = seq
            await ws.send_str(json.dumps(out))
    finally:
        lmk.close()
        print(f"disconnect {request.remote}", flush=True)
    return ws


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4842)
    ap.add_argument("--dist", default=os.path.join(HERE, "..", "dist"))
    ap.add_argument("--preload", default="itracker")
    a = ap.parse_args()
    if a.preload:
        get_model(a.preload)
    app = web.Application()
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/health", lambda r: web.json_response({"ok": True, "device": DEVICE, "models": list(_models)}))
    dist = os.path.abspath(a.dist)

    async def index(request):
        return web.FileResponse(os.path.join(dist, "index.html"))
    app.router.add_get("/", index)
    if os.path.isdir(dist):
        app.router.add_static("/", dist)
    print(f"gaze server on 127.0.0.1:{a.port} device={DEVICE} dist={dist}", flush=True)
    web.run_app(app, host="127.0.0.1", port=a.port, print=None)


if __name__ == "__main__":
    main()

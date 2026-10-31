"""Offline checks for the iTracker server pipeline (diesel2).
usage: python tools/check.py <GazeCapture/pytorch dir> <frames dir with *.png> <out dir>
1. Our model definition vs GazeCapture's ITrackerModel.py: same checkpoint, same random inputs.
2. Runs the full per-frame pipeline on the frames, saves crops, and compares the average
   face/eye crop with the released mean images (correlation) to check the box mapping.
"""
import glob, os, sys
import numpy as np, scipy.io as sio, torch, cv2, mediapipe as mp
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
import models
from mediapipe.tasks.python import BaseOptions, vision

ref_dir, frames_dir, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
dev = "cuda"
predict = models.load("itracker", dev)

# 1. reference model
sys.path.insert(0, ref_dir)
from ITrackerModel import ITrackerModel  # noqa: E402
ref = ITrackerModel()
ck = torch.load(os.path.join(models.ASSETS, "checkpoint.pth.tar"), map_location="cpu", weights_only=True)
ref.load_state_dict({k.removeprefix("module."): v for k, v in ck["state_dict"].items()})
ref.eval()
ours = models.ITracker(); ours.load_state_dict(ref.state_dict()); ours.eval()
g = torch.Generator().manual_seed(0)
x = [torch.randn(4, 3, 224, 224, generator=g) * 0.3 for _ in range(3)] + [(torch.rand(4, 625, generator=g) > 0.8).float()]
with torch.no_grad():
    a = ref(*x); b = ours(*x); c = ours.to(dev)(*[t.to(dev) for t in x]).cpu()
print("ref vs ours (cpu) max abs diff cm:", (a - b).abs().max().item(), " ref vs ours (cuda):", (a - c).abs().max().item())

# 2. pipeline on frames
lmk = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=os.path.join(models.ASSETS, "face_landmarker.task")),
    running_mode=vision.RunningMode.IMAGE, num_faces=1))
acc = {k: [] for k in ("face", "left", "right")}
for i, p in enumerate(sorted(glob.glob(os.path.join(frames_dir, "*.png")))):
    rgb = np.asarray(Image.open(p).convert("RGB"))
    r = lmk.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    if not r.face_landmarks: continue
    H, W = rgb.shape[:2]
    lm = np.array([[q.x * W, q.y * H] for q in r.face_landmarks[0]], np.float32)
    o = predict(rgb, lm)
    for k, im in zip(acc, o["crops"]): acc[k].append(im.astype(np.float32))
    if i % 4 == 0:
        print(os.path.basename(p), "gaze cm", np.round(o["gaze"], 2), "face", np.round(o["face"]).astype(int), "grid", o["grid"])
    if i == 4:
        Image.fromarray(np.concatenate(o["crops"], 1)).save(os.path.join(out, "crops.png"))
        v = rgb.copy()
        fx, fy, fw, fh = map(int, o["face"])
        cv2.rectangle(v, (fx, fy), (fx + fw, fy + fh), (0, 255, 0), 2)
        for e in (o["eyeL"], o["eyeR"]):
            ex, ey, ew, eh = map(int, e)
            cv2.rectangle(v, (fx + ex, fy + ey), (fx + ex + ew, fy + ey + eh), (255, 0, 0), 2)
        Image.fromarray(v).save(os.path.join(out, "boxes.png"))
row = []
for k in acc:
    m = np.mean(acc[k], 0)
    ref_m = sio.loadmat(os.path.join(models.ASSETS, f"mean_{k}_224.mat"), squeeze_me=True)["image_mean"][..., ::-1]  # BGR -> RGB
    A, B = m.mean(2), ref_m.mean(2)
    corr = np.corrcoef(A.ravel(), B.ravel())[0, 1]
    print(f"mean {k} crop vs released mean ({len(acc[k])} frames): luminance correlation {corr:.3f}")
    row.append(np.concatenate([m, ref_m], 0))
Image.fromarray(np.clip(np.concatenate(row, 1), 0, 255).astype(np.uint8)).save(os.path.join(out, "means_vs_ours.png"))

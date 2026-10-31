"""Gaze models served by server.py.

A model is loaded by name with `load(name, device)` and returns `predict(rgb, lm) -> dict`:
  rgb: HxWx3 uint8 frame (unmirrored camera view), lm: (478, 2) MediaPipe landmarks in pixels.
The dict must hold "gaze" (model output, list of floats) and may hold anything else
(boxes, crops for debugging). Add a new model by writing another loader below and adding
it to LOADERS; the server and browser protocol stay the same.
"""
import os
import numpy as np
import scipy.io as sio
import torch
import torch.nn as nn
from PIL import Image

ASSETS = os.environ.get("GAZE_ASSETS", os.path.expanduser("~/devfs/gaze-itracker-ext/assets"))


# --- iTracker (Krafka et al., CVPR 2016), PyTorch re-implementation by Petr Kellnhofer ---
# Same layers and parameter names as GazeCapture/pytorch/ITrackerModel.py so its
# checkpoint.pth.tar loads unchanged.

def LRN():
    # Same formula as the reference's nn.CrossMapLRN2d(5, 1e-4, 0.75, 1), which loops over
    # channels in Python (~2 ms per call on the GPU); this is ~0.1 ms. Outputs agree to
    # within ~1e-3 cm end to end (tools/check.py).
    return nn.LocalResponseNorm(size=5, alpha=0.0001, beta=0.75, k=1.0)


def _image_net():
    return nn.Sequential(
        nn.Conv2d(3, 96, kernel_size=11, stride=4, padding=0), nn.ReLU(inplace=True),
        nn.MaxPool2d(kernel_size=3, stride=2), LRN(),
        nn.Conv2d(96, 256, kernel_size=5, stride=1, padding=2, groups=2), nn.ReLU(inplace=True),
        nn.MaxPool2d(kernel_size=3, stride=2), LRN(),
        nn.Conv2d(256, 384, kernel_size=3, stride=1, padding=1), nn.ReLU(inplace=True),
        nn.Conv2d(384, 64, kernel_size=1, stride=1, padding=0), nn.ReLU(inplace=True),
    )


class _Conv(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = _image_net()

    def forward(self, x):
        return self.features(x).flatten(1)


class _Face(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = _Conv()
        self.fc = nn.Sequential(nn.Linear(12 * 12 * 64, 128), nn.ReLU(inplace=True), nn.Linear(128, 64), nn.ReLU(inplace=True))

    def forward(self, x):
        return self.fc(self.conv(x))


class _Grid(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc = nn.Sequential(nn.Linear(625, 256), nn.ReLU(inplace=True), nn.Linear(256, 128), nn.ReLU(inplace=True))

    def forward(self, x):
        return self.fc(x.flatten(1))


class ITracker(nn.Module):
    def __init__(self):
        super().__init__()
        self.eyeModel = _Conv()
        self.faceModel = _Face()
        self.gridModel = _Grid()
        self.eyesFC = nn.Sequential(nn.Linear(2 * 12 * 12 * 64, 128), nn.ReLU(inplace=True))
        self.fc = nn.Sequential(nn.Linear(128 + 64 + 128, 128), nn.ReLU(inplace=True), nn.Linear(128, 2))

    def forward(self, face, eyeL, eyeR, grid):
        eyes = self.eyesFC(torch.cat((self.eyeModel(eyeL), self.eyeModel(eyeR)), 1))
        return self.fc(torch.cat((eyes, self.faceModel(face), self.gridModel(grid)), 1))


# Apple-style boxes from MediaPipe landmarks. GazeCapture's crops came from AVFoundation face
# boxes and CIDetector eye boxes, which we do not have. The mapping below is fitted to the
# released mean images (mean_*_224.mat, the average of every training crop):
#  - mean face: eye centres at x = 0.295 / 0.705 and y = 0.286 of a square box, so the box
#    side is (eye-centre distance) / 0.41, placed so the eye midpoint sits at (0.5, 0.286).
#  - mean eye crops: template-matching them into the mean face gives a square box 0.29-0.32
#    of the face side, centred ~0.035 face-sides to image-left of the eye centre (the iris
#    sits at x = 0.63, y = 0.56 of the mean eye crop, in both eyes).
# Eye centre = midpoint of the two eye corners (stable under gaze, unlike the iris). Boxes stay
# axis-aligned like Apple's, so head roll is not removed.
FACE_PER_IOD = 1 / 0.41
EYE_ROW = 0.286
EYE_SIZE = 0.305
EYE_DX, EYE_DY = -0.035, 0.004


def apple_boxes(lm):
    """Face box in frame px and eye boxes relative to the face box, as [x, y, w, h]."""
    eR = (lm[33] + lm[133]) / 2  # subject's right eye, image left
    eL = (lm[362] + lm[263]) / 2  # subject's left eye, image right
    s = float(np.hypot(*(eL - eR))) * FACE_PER_IOD
    mid = (eL + eR) / 2
    face = [float(mid[0] - s / 2), float(mid[1] - EYE_ROW * s), s, s]
    def eye(c):
        e = EYE_SIZE * s
        cx, cy = c[0] + EYE_DX * s - face[0], c[1] + EYE_DY * s - face[1]
        return [float(cx - e / 2), float(cy - e / 2), e, e]
    return face, eye(eL), eye(eR)


def crop_repeating_edge(img, rect):
    """GazeCapture code/cropRepeatingEdge.m: integer crop, edge pixels repeated outside."""
    x, y, w, h = (int(np.floor(v + 0.5)) for v in rect)
    ys = np.clip(np.arange(y, y + h), 0, img.shape[0] - 1)
    xs = np.clip(np.arange(x, x + w), 0, img.shape[1] - 1)
    return img[ys][:, xs]


def face_grid(face, W, H, n=25):
    """faceGridFromFaceRect.m (parameterized) + ITrackerData.makeGrid, including makeGrid's
    use of the 1-based x/y as 0-based cell indices (that is what the checkpoint was trained on)."""
    r = lambda v: int(np.floor(v + 0.5))
    x, y, w, h = r(face[0] * n / W) + 1, r(face[1] * n / H) + 1, r(face[2] * n / W), r(face[3] * n / H)
    g = np.zeros((n, n), np.float32)
    g[max(0, y):max(0, y + h), max(0, x):max(0, x + w)] = 1
    return g.reshape(-1), [x, y, w, h]


def load_itracker(device):
    net = ITracker()
    ck = torch.load(os.path.join(ASSETS, "checkpoint.pth.tar"), map_location="cpu", weights_only=True)
    net.load_state_dict({k.removeprefix("module."): v for k, v in ck["state_dict"].items()})
    net.eval().to(device)
    # The .mat means are stored BGR (Caffe), but ITrackerData.py subtracts them from PIL RGB
    # tensors as-is; the checkpoint was trained that way, so do the same.
    mean = {n: torch.tensor(sio.loadmat(os.path.join(ASSETS, f"mean_{n}_224.mat"), squeeze_me=True)["image_mean"] / 255,
                            dtype=torch.float32).permute(2, 0, 1).to(device) for n in ("face", "left", "right")}

    def tensor(crop, m):
        # transforms.Resize((224, 224)) on a PIL image = bilinear with antialiasing.
        im = np.asarray(Image.fromarray(crop).resize((224, 224), Image.BILINEAR))
        return im, (torch.from_numpy(im).to(device).permute(2, 0, 1).float() / 255 - mean[m])[None]

    @torch.inference_mode()
    def predict(rgb, lm):
        face, eL, eR = apple_boxes(lm)
        fimg = crop_repeating_edge(rgb, face)
        f, ft = tensor(fimg, "face")
        l, lt = tensor(crop_repeating_edge(fimg, eL), "left")
        r, rt = tensor(crop_repeating_edge(fimg, eR), "right")
        grid, gp = face_grid(face, rgb.shape[1], rgb.shape[0])
        out = net(ft, lt, rt, torch.from_numpy(grid).to(device)[None])[0].tolist()
        return {"gaze": out, "face": face, "eyeL": eL, "eyeR": eR, "grid": gp, "crops": (f, l, r)}

    return predict


LOADERS = {"itracker": load_itracker}


def load(name, device):
    return LOADERS[name](device)

"""Writes the mel filterbank of the export's nemo128.onnx as raw f32 (257 rows of 128), for the
browser page's JS mel front end (onnxruntime-web cannot run nemo128.onnx: no float64 Cast kernel).
usage: uv run --no-project --python 3.12 --with onnx --with numpy scripts/mel-filterbank.py cache/onnx-tdt-v2"""
import sys
import numpy as np
import onnx
from onnx import numpy_helper

d = sys.argv[1]
m = onnx.load(f"{d}/nemo128.onnx")
fb = next(numpy_helper.to_array(i) for i in m.graph.initializer if tuple(i.dims) == (257, 128))
fb.astype("<f4").tofile(f"{d}/melfb-257x128.f32")
print(fb.shape, float(fb.sum()))

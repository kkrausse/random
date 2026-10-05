#!/usr/bin/env python3
"""Convert the unified encoder ONNX to float16 weights (float32 inputs/outputs kept).

Halves what has to be read from disk and copied to the GPU at session creation.
usage: onnx-fp16.py SRC_DIR DST_DIR   (needs: onnx, onnxconverter-common)
"""
import os
import sys

import onnx
from onnxconverter_common import float16

source, target = sys.argv[1], sys.argv[2]
os.makedirs(target, exist_ok=True)
# The model is over protobuf's 2 GB limit, so in-memory shape inference is not available; the
# converter needs value types though (without them it leaves float32/float16 mismatches), so run
# the on-disk variant first. The inferred graph sits next to the source to share its external data.
inferred = os.path.join(source, "encoder.inferred.onnx")
onnx.shape_inference.infer_shapes_path(os.path.join(source, "encoder.onnx"), inferred)
model = onnx.load(inferred)
os.remove(inferred)
# Ops listed in op_block_list stay float32 (the converter inserts Casts around them).
blocked = [name for name in sys.argv[3:]]
model = float16.convert_float_to_float16(
    model, keep_io_types=True, disable_shape_infer=True, op_block_list=float16.DEFAULT_OP_BLOCK_LIST + blocked)
# The converter retypes value_info to float16 but leaves the graph's own Cast(to=FLOAT) nodes alone,
# which ORT rejects. Point those casts at float16 wherever their output was retyped.
half = {info.name for info in model.graph.value_info if info.type.tensor_type.elem_type == onnx.TensorProto.FLOAT16}
recast = 0
for node in model.graph.node:
    if node.op_type == "Cast" and node.output[0] in half:
        for attribute in node.attribute:
            if attribute.name == "to" and attribute.i == onnx.TensorProto.FLOAT:
                attribute.i = onnx.TensorProto.FLOAT16
                recast += 1
print(f"recast {recast} Cast nodes to float16")
onnx.save(model, os.path.join(target, "encoder.onnx"), save_as_external_data=True, all_tensors_to_one_file=True,
          location="encoder.onnx.data", size_threshold=1024)
for name in ("decoder_joint.onnx", "tokenizer.model"):
    link = os.path.join(target, name)
    if not os.path.exists(link):
        os.symlink(os.path.join(os.path.abspath(source), name), link)
print(sorted((name, os.path.getsize(os.path.join(target, name))) for name in os.listdir(target)))

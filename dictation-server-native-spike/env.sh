# Source this before building or running anything in the spike.
# Everything heavy lives on ~/devfs (root fs is nearly full).
export SPIKE_CACHE=$HOME/devfs/cache/native-spike
export CARGO_HOME=$SPIKE_CACHE/cargo-home
export XDG_CACHE_HOME=$SPIKE_CACHE/xdg          # ort-sys downloads ONNX Runtime here
export RUSTUP_TOOLCHAIN=1.95.0                  # parakeet-rs is edition 2024; system default is 1.75
export MODELS=$SPIKE_CACHE/models
# CUDA 13 / cuDNN 9 shared libs bundled with the PyTorch wheels of the Python server.
NV=$HOME/devfs/repos/kkrausse/random/dictation-server-linux/.venv/lib/python3.12/site-packages/nvidia
export NV_LIBS=$NV/cu13/lib:$NV/cudnn/lib

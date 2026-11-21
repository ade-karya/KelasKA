# Preparing the `kelaska-gpu-models` Kaggle dataset

A Kaggle GPU session starts on a fresh container. Without a dataset mount,
every cold start spends 10+ minutes and several GB re-downloading SDXL,
FunASR, VoxCPM2 and Ollama weights. The private dataset below is mounted read-
only into the kernel and linked into the writable model directory by
`scripts/gpu-services.sh` (`GPU_MODEL_CACHE`).

## Expected layout

```
kelaska-gpu-models/
├── comfyui/
│   └── models/
│       └── checkpoints/
│           └── sd_xl_base_1.0.safetensors      (~6.9 GB)
├── hf/                                         (HF cache: hub/, xet/)
│   └── hub/
│       ├── models--Open-AI-Speech--VoxCPM2/    (or the exact VoxCPM cache id)
│       └── models--iic--SenseVoiceSmall/
├── modelscope/                                 (modelscope cache, if used)
└── ollama/                                     (Ollama models/ layout)
    ├── blobs/
    └── manifests/
        └── registry.ollama.ai/
            └── library/
                └── llama3.2/
                    └── 3b/                      (tag file with the digest)
```

The container paths are read-only. `gpu-services.sh` only **links** files that
already exist there; anything missing is still downloaded into
`/kaggle/temp/gpu-models`, so a partial dataset degrades gracefully.

## Building it once on a machine with a GPU

The simplest source is a host that already ran `scripts/gpu-services.sh` with
the same model versions (see AGENTS.md → "Local GPU model services"). Copy the
model directory it produced:

```bash
GPU_DIR=/opt/gpu-models              # or /kaggle/working/gpu-models on a prior run
STAGE=$(mktemp -d)
mkdir -p "$STAGE/comfyui/models/checkpoints" "$STAGE/hf" "$STAGE/modelscope" "$STAGE/ollama"
cp -a "$GPU_DIR/comfyui/models/checkpoints/." "$STAGE/comfyui/models/checkpoints/"
cp -a "$GPU_DIR/hf/." "$STAGE/hf/"
cp -a "$GPU_DIR/modelscope/." "$STAGE/modelscope/"
cp -a "$GPU_DIR/ollama/." "$STAGE/ollama/"
```

Without an existing GPU host, let one Kaggle run populate `/kaggle/temp/gpu-models`
(the Worker's first start), then copy that directory into a new dataset version.
Subsequent starts are fast.

## Publishing

```bash
# First version
kaggle datasets create -p "$STAGE" \
  --dir-mode zip \
  -m 'KelasKA GPU model weights (ComfyUI/SDXL, HF caches, Ollama)' \
  --private

# Later versions (keeps the same dataset slug)
kaggle datasets version -p "$STAGE" -m 'refresh weights' --dir-mode zip
```

The dataset slug must match the Worker's `KAGGLE_DATASET` variable
(`akjdev/kelaska-gpu-models`). Kaggle mounts it at
`/kaggle/input/kelaska-gpu-models/`; the kernel also auto-detects any
`/kaggle/input/*` directory containing `comfyui/` or `ollama/`.

## Size and quota notes

- Kaggle private datasets have a size limit; check the current limit before
  adding more checkpoints. SDXL alone is ~6.9 GB and VoxCPM2 a few GB.
- Do not copy the `.venv*`, ComfyUI source tree, logs or PID files into the
  dataset — those are installed or created on every run by the kernel.
- Keep `hf/` and `modelscope/` caches in the dataset even if a model appears
  unused: FunASR/VoxCPM download through HF at import time and a missing cache
  entry silently adds minutes to the cold start.

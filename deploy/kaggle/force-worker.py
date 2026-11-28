"""Force a fresh Kaggle worker kernel without the Vercel wake cooldown.

Used by start-gpu-worker.sh when /api/wake answers `cooldown`. Reads the same
Vercel Secrets the wake function injects, from the process environment (the
CPU session has them) or .env.local, and pushes the same kernel source.
"""
from __future__ import annotations

import base64
import json
import os
import urllib.request
from pathlib import Path

GPU = os.environ.get("KELASKA_MODE", "app") == "gpu-worker"
REF = os.environ.get("KAGGLE_GPU_KERNEL_REF" if GPU else "KAGGLE_KERNEL_REF", "")
if not REF:
    REF = "akjdev/kelaska-gpu-worker" if GPU else "akjdev/kelaska-compute"
ENV_FILE = Path(os.environ.get("KELASKA_ENV_FILE", "/kaggle/temp/KelasKA/.env.local"))

values: dict[str, str] = {}
if ENV_FILE.is_file():
    for line in ENV_FILE.read_text(errors="replace").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value.strip().strip('"\'')
for key in [
    "KAGGLE_KEY",
    "KAGGLE_USERNAME",
    "KAGGLE_DATASETS",
    "KAGGLE_KERNEL_SOURCE_URL",
    "KAGGLE_MACHINE_SHAPE",
    "KELASKA_ENV_B64",
    "KELASKA_ENV_B64_1",
    "KELASKA_ENV_B64_2",
    "KELASKA_ENV_B64_3",
    "KELASKA_ENV_B64_4",
    "KELASKA_AUTH_PUBLIC_URL",
    "KELASKA_APP_TUNNEL_TOKEN",
    "KELASKA_GPU_TUNNEL_TOKEN",
    "KELASKA_GPU_PUBLIC_URL",
    "KELASKA_PROXY_TOKEN",
    "KELASKA_GITHUB_TOKEN",
    "KELASKA_MODE",
    "KELASKA_PUBLISH_MODELS",
]:
    if os.environ.get(key):
        values[key] = os.environ[key]

key = values.get("KAGGLE_KEY", "")
user = values.get("KAGGLE_USERNAME", "")
if not key:
    raise SystemExit("KAGGLE_KEY is missing")
auth = "Bearer " + key if key.startswith("KGAT_") else "Basic " + base64.b64encode(
    f"{user}:{key}".encode()
).decode()

encoded = "".join(values.get(f"KELASKA_ENV_B64_{i}", "") for i in range(1, 9)) or values.get(
    "KELASKA_ENV_B64", ""
)
if not encoded and ENV_FILE.is_file():
    # On the CPU session the value is not stored as a named variable; derive it
    # from the same .env.local the main app uses.
    encoded = base64.b64encode(ENV_FILE.read_bytes()).decode()
if not encoded:
    raise SystemExit("KELASKA_ENV_B64 is missing")
env_text = base64.b64decode(encoded).decode("utf-8")
parsed: dict[str, str] = {}
for line in env_text.splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        parsed[k] = v.strip().strip('"\'')
parsed["KELASKA_ENV_B64"] = encoded
overrides = [
    "KELASKA_AUTH_PUBLIC_URL",
    "KELASKA_APP_TUNNEL_TOKEN",
    "KELASKA_GPU_TUNNEL_TOKEN",
    "KELASKA_GPU_PUBLIC_URL",
    "KELASKA_PROXY_TOKEN",
    "KELASKA_GITHUB_TOKEN",
    "KELASKA_MODE",
    "KELASKA_PUBLISH_MODELS",
]
for name in overrides:
    if values.get(name):
        parsed[name] = values[name]
parsed["KELASKA_MODE"] = "gpu-worker" if GPU else "app"

source_url = values.get("KAGGLE_KERNEL_SOURCE_URL") or (
    "https://raw.githubusercontent.com/ade-karya/KelasKA/refs/heads/"
    "deploy/kaggle/deploy/kaggle/kelaska-vercel-kernel.py"
)
with urllib.request.urlopen(source_url, timeout=30) as response:
    source = response.read().decode()
payload = base64.b64encode(json.dumps(parsed).encode()).decode()
prefix = (
    "# App environment injected by the Vercel wake function (Vercel Secret, not Kaggle Secrets).\n"
    "import os as _kelaska_env_os, base64 as _kelaska_env_b64, json as _kelaska_env_json\n"
    f"_kelaska_env_os.environ.update(_kelaska_env_json.loads(_kelaska_env_b64.b64decode('{payload}').decode('utf-8')))\n"
)
lines = source.splitlines()
index = next((i for i, l in enumerate(lines) if l.startswith("from __future__ import ")), -1)
lines.insert(index + 1, prefix)

datasets = [d.strip() for d in values.get("KAGGLE_DATASETS", "").split(",") if d.strip()]
body = {
    "slug": REF,
    "newTitle": "KelasKA GPU Worker" if GPU else "KelasKA Compute",
    "text": "\n".join(lines),
    "language": "python",
    "kernelType": "script",
    "isPrivate": True,
    "enableGpu": GPU,
    "enableInternet": True,
    "datasetDataSources": datasets,
    "modelDataSources": [
        m.strip()
        for m in values.get("KAGGLE_MODEL_DATASOURCES", "akjdev/kelaska-gpu-models/PyTorch/default").split(",")
        if m.strip()
    ],
    "categoryIds": [],
    "kernelExecutionType": "SAVE_AND_RUN_ALL",
    "sessionTimeoutSeconds": 42000,
}
if GPU and values.get("KAGGLE_MACHINE_SHAPE"):
    # Do not force T4 x2 by default: a plain T4 has a much shorter queue.
    body["machineShape"] = values["KAGGLE_MACHINE_SHAPE"]

request = urllib.request.Request(
    "https://api.kaggle.com/v1/kernels.KernelsApiService/SaveKernel",
    data=json.dumps(body).encode(),
    headers={
        "authorization": auth,
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": "kelaska-force-worker/1.0",
    },
    method="POST",
)
with urllib.request.urlopen(request, timeout=60) as response:
    print(f"started {REF}: {response.status}")

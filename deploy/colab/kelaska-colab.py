# %% [markdown]
# # KelasKA — Colab app node
#
# This is the manually started half of the deployment. It runs the full
# Next.js app (UI APIs, generation engine, agent runtime) and publishes it at
# `api.kelaska.riau.ai` through a Cloudflare Tunnel. The public site
# `kelaska.riau.ai` is a Cloudflare Worker that sends light traffic to Vercel
# and heavy traffic here.
#
# GPU services do **not** run here. They run in the Kaggle kernel and are
# reached through `gpu.kelaska.riau.ai` by the loopback proxy started below.
#
# Before running:
# 1. Colab → Secrets: add `KELASKA_ENV_B64` (base64 of the production
#    `.env.local`) and `KELASKA_COLAB_TUNNEL_TOKEN`.
# 2. Optional: `KELASKA_OPENMAIC_YML_B64` (base64 of the full `openmaic.yml`).
#    Without it, `deploy/colab/openmaic.colab.yml` is used.
# 3. Use a **CPU** runtime. The Colab GPU is not needed; Kaggle owns the GPU.
#
# Keep this tab open. Closing it (or the Colab idle timeout) stops the app.

# %%
from __future__ import annotations

import base64
import os
import subprocess
from pathlib import Path

REPO_URL = os.environ.get("KELASKA_REPO_URL", "https://github.com/ade-karya/KelasKA.git")
BRANCH = os.environ.get("KELASKA_BRANCH", "Colab")
APP_DIR = Path(os.environ.get("KELASKA_APP_DIR", "/content/KelasKA"))


def secret(name: str, default: str = "") -> str:
    try:
        from google.colab import userdata  # type: ignore

        return userdata.get(name) or default
    except Exception:
        return os.environ.get(name, default)


def run(*args: str, cwd: Path | None = None) -> None:
    print("$", " ".join(args))
    subprocess.run(args, cwd=str(cwd) if cwd else None, check=True)


if APP_DIR.exists():
    run("git", "-C", str(APP_DIR), "fetch", "origin", BRANCH)
    run("git", "-C", str(APP_DIR), "checkout", BRANCH)
    run("git", "-C", str(APP_DIR), "pull", "--ff-only", "origin", BRANCH)
else:
    run("git", "clone", "--branch", BRANCH, "--depth", "1", REPO_URL, str(APP_DIR))
print("repo ready:", APP_DIR)

# %%
# Write the production environment from Colab Secrets. This file is never
# committed; it is the same set of secrets the Vercel project uses.
env_b64 = secret("KELASKA_ENV_B64")
if not env_b64:
    raise SystemExit(
        "KELASKA_ENV_B64 is empty. Add the base64-encoded production .env.local "
        "to Colab Secrets first."
    )
env_text = base64.b64decode(env_b64).decode("utf-8")
if "AUTH_PUBLIC_URL=" not in env_text:
    env_text += "\nAUTH_PUBLIC_URL=https://kelaska.riau.ai\n"
(APP_DIR / ".env.local").write_text(env_text, encoding="utf-8")
os.chmod(APP_DIR / ".env.local", 0o600)
print("wrote .env.local:", len(env_text), "bytes")

# %%
# Build once per Colab runtime. A rerun with a warm .next only reloads PM2;
# set KELASKA_REINSTALL=1 to force a full install/build.
build_id = APP_DIR / ".next" / "BUILD_ID"
if not build_id.exists() or os.environ.get("KELASKA_REINSTALL") == "1":
    run("bash", "install.sh", "--colab", "--no-gpu", "--yes", cwd=APP_DIR)
else:
    print("existing build found; skipping install.sh")

# %%
# Model config: use the operator's full openmaic.yml when supplied, otherwise
# the Colab template whose GPU base URLs point at the loopback proxy.
openmaic_b64 = secret("KELASKA_OPENMAIC_YML_B64")
if openmaic_b64:
    (APP_DIR / "openmaic.yml").write_text(
        base64.b64decode(openmaic_b64).decode("utf-8"), encoding="utf-8"
    )
    print("wrote openmaic.yml from KELASKA_OPENMAIC_YML_B64")
else:
    template = APP_DIR / "deploy" / "colab" / "openmaic.colab.yml"
    (APP_DIR / "openmaic.yml").write_text(template.read_text(encoding="utf-8"), encoding="utf-8")
    print("wrote openmaic.yml from deploy/colab/openmaic.colab.yml")

# %%
# Start the loopback GPU proxy, the Cloudflare Tunnel, and PM2.
tunnel_token = secret("KELASKA_COLAB_TUNNEL_TOKEN")
if not tunnel_token:
    raise SystemExit("KELASKA_COLAB_TUNNEL_TOKEN is empty. Add it to Colab Secrets.")
os.environ["KELASKA_COLAB_TUNNEL_TOKEN"] = tunnel_token
run("bash", "deploy/colab/start.sh", cwd=APP_DIR)

# %%
# Verify from inside the runtime. The public endpoint is checked from the
# Worker's side; this only proves the local app and tunnel processes are up.
run("bash", "-lc", "curl -fsS http://127.0.0.1:3000/api/health || true")
run("bash", "-lc", "tail -n 30 /tmp/kelaska-cloudflared.log || true")
print(
    "\nKeep this tab open. The Worker will mark Colab online within two minutes "
    "after the tunnel connects."
)

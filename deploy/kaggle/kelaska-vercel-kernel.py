# %% [markdown]
# # KelasKA — Kaggle compute node for the Vercel UI
#
# This notebook turns a **Kaggle session** into the compute half of the split
# deployment:
#
# - the full Next.js app (API + generation engine) runs on `127.0.0.1:3000`;
# - one Cloudflare Tunnel publishes the app;
# - the Vercel project (`deploy/vercel` branch) serves the static UI and proxies
#   every `/api/*` call here;
# - **CPU is the default**: GPU services (ComfyUI/VoxCPM/FunASR) start only when
#   the session actually has a GPU. A GPU session is started on demand by
#   `POST /api/wake` with `{"gpu": true}`.
#
# ## Before you run
#
# 1. **Settings → Accelerator → None** for CPU-only (no weekly GPU quota), or
#    **GPU T4 x2** only when GPU generation is needed. The kernel detects the
#    accelerator and picks `openmaic.cpu.yml` or `openmaic.kaggle.yml` accordingly.
# 2. **Kaggle → Add-ons → Secrets** (the notebook reads them; never paste them
#    into a cell):
#
# | Secret | Required | Meaning |
# | --- | --- | --- |
# | `KELASKA_ENV_B64` | yes | `base64 -w0 .env.local` of the app environment (Supabase, database, Gemini, secrets) |
# | `KELASKA_AUTH_PUBLIC_URL` | yes with accounts | the Vercel production URL, e.g. `https://kelaska.vercel.app` |
# | `KELASKA_PROXY_TOKEN` | strongly recommended | shared secret the Vercel rewrite injects; without it the tunnel is open |
# | `KELASKA_APP_TUNNEL_TOKEN` | app mode | Cloudflare named tunnel token for `api.<domain>` -> :3000 |
# | `KELASKA_GPU_TUNNEL_TOKEN` | gpu-worker mode | Cloudflare named tunnel token for `gpu.<domain>` -> :8790 |
# | `KELASKA_GITHUB_TOKEN` | private repo only | token that can clone `ade-karya/KelasKA` |
# | `KELASKA_OPENMAIC_YML_B64` | optional | override `deploy/kaggle/openmaic.kaggle.yml` |
#
# 3. In Vercel (Project → Settings → Environment Variables), set:
#    `KAGGLE_ORIGIN=https://<tunnel-host>` and
#    `KAGGLE_PROXY_TOKEN=<same value as KELASKA_PROXY_TOKEN>`.
#
# A **named** tunnel keeps the hostname across restarts, so `KAGGLE_ORIGIN`
# never changes. A quick tunnel prints a new URL on every start; update
# `KAGGLE_ORIGIN` and redeploy when that happens.

# %%
from __future__ import annotations

import base64
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# %% [markdown]
# ## Configuration
#
# The defaults match the split-deployment branches. Override them with the
# environment (or edit this cell) only when the fork lives elsewhere.

# %%
REPO_URL = os.environ.get("KELASKA_REPO_URL", "https://github.com/ade-karya/KelasKA.git")
REPO_REF = os.environ.get("KELASKA_REPO_REF", "deploy/kaggle")
SRC_DIR = Path(os.environ.get("KELASKA_SRC_DIR", "/kaggle/temp/KelasKA-src"))
APP_DIR = Path(os.environ.get("KELASKA_APP_DIR", "/kaggle/temp/kelaska-app"))
GPU_DIR = Path(os.environ.get("KELASKA_GPU_DIR", "/kaggle/temp/gpu-models"))
LOG_DIR = Path(os.environ.get("KELASKA_LOG_DIR", "/kaggle/temp/kelaska-logs"))
APP_PORT = 3000
# The gpu. tunnel's ingress points at 127.0.0.1:8790 on this kernel.
PROXY_PORT = int(os.environ.get("KELASKA_GPU_PROXY_PORT", "8790"))
# `app` (default) serves the full Next app + tunnel; `gpu-worker` starts only
# the GPU services + the separate gpu. tunnel so it can run beside an app
# session (no second DB pool, no competing api. tunnel).
MODE = os.environ.get("KELASKA_MODE", "app").strip().lower()
IS_WORKER = MODE == "gpu-worker"
GPU_SERVICES = [
    name.strip()
    for name in os.environ.get("KELASKA_GPU_SERVICES", "comfyui,funasr,voxcpm").split(",")
    if name.strip()
]
BUN_VERSION = os.environ.get("KELASKA_BUN_VERSION", "1.4.4")
MAX_RUNTIME_SECONDS = int(os.environ.get("KELASKA_MAX_RUNTIME", "42000"))  # 11h40m

CHILDREN: list[subprocess.Popen] = []
STOP_REQUESTED = False
CLEANED = False
TUNNEL_URL = ""


def log(message: str) -> None:
    print(f"[kelaska] {time.strftime('%H:%M:%S')} {message}", flush=True)


def has_gpu() -> bool:
    """CPU is the default; a GPU session is only started on explicit request."""
    if not shutil.which("nvidia-smi"):
        return False
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0 and bool(result.stdout.strip())


def run(
    *args: str,
    check: bool = True,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    logfile: Path | None = None,
) -> subprocess.CompletedProcess:
    log("$ " + " ".join(args))
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    sink = open(logfile, "ab") if logfile else subprocess.DEVNULL
    try:
        return subprocess.run(
            args,
            check=check,
            cwd=str(cwd) if cwd else None,
            env=env,
            stdout=sink,
            stderr=subprocess.STDOUT,
        )
    finally:
        if logfile:
            sink.close()


def secret(name: str, default: str = "", retries: int = 6) -> str:
    """Read a Kaggle Secret, with a short retry window right after start."""
    value = os.environ.get(name, "")
    if value:
        return value
    for attempt in range(retries):
        try:
            from kaggle_secrets import UserSecretsClient  # type: ignore

            value = UserSecretsClient().get_secret(name) or default
            if value:
                return value
        except Exception as error:  # local dry run without the Kaggle runtime
            if attempt == retries - 1:
                log(f"secret {name} unavailable: {error}")
            else:
                time.sleep(3)
    return default


def port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1)
        return sock.connect_ex(("127.0.0.1", port)) == 0


# %% [markdown]
# ## 1. Bun and the repository
#
# Kaggle images change their Node version; Bun is the runtime this repository
# pins (`packageManager: bun@1.4.4`) and the one `install.sh` uses. It is
# fetched from the npm registry, because the official installer downloads from
# GitHub Releases and that host intermittently answers 504 on Kaggle.

# %%
def install_bun() -> str:
    existing = shutil.which("bun")
    if existing:
        log(f"bun already installed: {existing}")
        return existing

    arch = "x64" if os.uname().machine in {"x86_64", "amd64"} else "arm64"
    package = f"@oven/bun-linux-{arch}"
    url = f"https://registry.npmjs.org/{package}/-/{package.split('/')[-1]}-{BUN_VERSION}.tgz"
    target = Path("/usr/local/bin/bun")
    log(f"downloading {package}@{BUN_VERSION} from the npm registry")
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "bun.tgz"
        for attempt in range(3):
            try:
                urllib.request.urlretrieve(url, archive)
                break
            except Exception as error:
                if attempt == 2:
                    raise
                log(f"bun download attempt {attempt + 1} failed: {error}; retrying")
                time.sleep(3)
        with tarfile.open(archive) as tar:
            member = next(item for item in tar.getmembers() if item.name.endswith("/bin/bun"))
            member.name = "bun"
            tar.extract(member, path=tmp)
        binary = Path(tmp) / "bun"
        binary.chmod(0o755)
        shutil.copy2(binary, target)
    log(f"bun installed: {target}")
    return str(target)


def unpack_staged() -> bool:
    """Restore staged app/source from private Kaggle dataset chunks.

    Kaggle rejects bracketed filenames (Next dynamic routes) even inside a
    zip, and zip loses the `.bun` symlinks Node needs. The stage is therefore a
    tar.gz stored as numbered base64 `.txt` files; Kaggle only sees plain text.
    """
    import io
    import tarfile

    found = False
    root = Path("/kaggle/input")
    if not root.is_dir():
        return False

    def restore(prefix: str, marker: Path, target: Path) -> None:
        nonlocal found
        if marker.is_file():
            return
        parts = []
        for candidate in sorted(root.iterdir()):
            parts.extend(sorted(candidate.glob(f"{prefix}_*.txt")))
        if not parts:
            return
        log(f"restoring staged {prefix} from {len(parts)} chunks")
        encoded = "".join(part.read_text(encoding="ascii") for part in parts)
        archive = io.BytesIO(base64.b64decode(encoded))
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        # tarfile preserves symlinks, unlike zipfile; entries were created
        # with `tar -C <dir> .` so they unpack straight into the target.
        with tarfile.open(fileobj=archive, mode="r:gz") as tf:
            tf.extractall(target)
        found = True

    restore("repo_targz_b64", SRC_DIR / "install.sh", SRC_DIR)
    restore("app_targz_b64", APP_DIR / "server.js", APP_DIR)
    return found


def clone_repo() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if (SRC_DIR / "install.sh").is_file():
        log(f"source already staged at {SRC_DIR}; skipping clone")
        return
    input_root = Path("/kaggle/input")
    staged = None
    if input_root.is_dir():
        staged = next(
            (
                candidate / "repo"
                for candidate in sorted(input_root.iterdir())
                if (candidate / "repo" / "install.sh").is_file()
            ),
            None,
        )
    if staged is not None:
        # Pre-staged private dataset: no GitHub clone, no network wait.
        log(f"using pre-staged repo from {staged}")
        if SRC_DIR.exists():
            shutil.rmtree(SRC_DIR)
        SRC_DIR.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(staged, SRC_DIR)
        return

    token = secret("KELASKA_GITHUB_TOKEN", retries=0)
    url = REPO_URL
    if token and url.startswith("https://github.com/"):
        url = url.replace("https://", f"https://x-access-token:{token}@", 1)

    if (SRC_DIR / ".git").is_dir():
        run("git", "-C", str(SRC_DIR), "fetch", "origin", REPO_REF, logfile=LOG_DIR / "git.log")
        run(
            "git",
            "-C",
            str(SRC_DIR),
            "reset",
            "--hard",
            f"origin/{REPO_REF}",
            logfile=LOG_DIR / "git.log",
        )
        return
    SRC_DIR.parent.mkdir(parents=True, exist_ok=True)
    run(
        "git",
        "clone",
        "--depth",
        "1",
        "--branch",
        REPO_REF,
        url,
        str(SRC_DIR),
        logfile=LOG_DIR / "git.log",
    )


# %% [markdown]
# ## 2. Environment
#
# The standalone server does not read `.env.local` by itself, so this cell both
# writes the file (for build-time tools) and merges its keys into the process
# environment that the server inherits.

# %%
def parse_env_file(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values


def prepare_environment() -> dict[str, str]:
    env_b64 = secret("KELASKA_ENV_B64")
    if not env_b64:
        raise SystemExit("KELASKA_ENV_B64 must be set as a Kaggle Secret")
    env_text = base64.b64decode(env_b64).decode("utf-8")

    values = parse_env_file(env_text)
    public_url = secret("KELASKA_AUTH_PUBLIC_URL", retries=0).rstrip("/")
    if public_url:
        values["AUTH_PUBLIC_URL"] = public_url
    elif values.get("AUTH_ENABLED", "").lower() in {"1", "true"}:
        log("WARNING: KELASKA_AUTH_PUBLIC_URL is unset; Google sign-in will")
        log("         redirect to the tunnel host instead of the Vercel domain.")

    proxy_token = secret("KELASKA_PROXY_TOKEN", retries=0)
    if proxy_token:
        values["KELASKA_PROXY_TOKEN"] = proxy_token
    else:
        log("WARNING: KELASKA_PROXY_TOKEN is unset; the tunnel is reachable")
        log("         without the Vercel proxy header.")

    # A 2× T4 box can synthesize two narration clips at once and run more
    # generation jobs than the single-GPU default.
    values.setdefault("OPENMAIC_AGENT_TTS_CONCURRENCY", "2")
    values.setdefault("OPENMAIC_GENERATION_RUN_MAX_CONCURRENT", "4")
    values.setdefault("HOSTNAME", "0.0.0.0")
    values.setdefault("PORT", str(APP_PORT))

    rendered = "\n".join(f"{key}={value}" for key, value in values.items()) + "\n"
    (SRC_DIR / ".env.local").write_text(rendered, encoding="utf-8")
    os.environ.update(values)
    log(f"environment prepared ({len(values)} keys)")

    yml_b64 = secret("KELASKA_OPENMAIC_YML_B64", retries=0)
    if yml_b64:
        (SRC_DIR / "openmaic.yml").write_text(
            base64.b64decode(yml_b64).decode("utf-8"), encoding="utf-8"
        )
        log("openmaic.yml written from KELASKA_OPENMAIC_YML_B64")
    else:
        template = "openmaic.kaggle.yml" if has_gpu() else "openmaic.cpu.yml"
        shipped = SRC_DIR / "deploy" / "kaggle" / template
        if not shipped.is_file():
            raise SystemExit(f"missing {shipped}")
        shutil.copy2(shipped, SRC_DIR / "openmaic.yml")
        log(f"openmaic.yml copied from deploy/kaggle/{template}")
        # The shipped config points agent.title at Ollama, which the older
        # GPU kernel starts but this one skips on purpose. Leaving the slot
        # assigned would send every conversation title to a dead endpoint
        # (10 s timeout, no title). Without the line the slot follows `agent`.
        if template == "openmaic.kaggle.yml" and "ollama" not in GPU_SERVICES:
            yml_path = SRC_DIR / "openmaic.yml"
            kept = [
                line
                for line in yml_path.read_text(encoding="utf-8").splitlines(keepends=True)
                if not line.lstrip().startswith("agent.title:")
            ]
            yml_path.write_text("".join(kept), encoding="utf-8")
            log("agent.title follows agent (Ollama is not started)")
    return values


# %% [markdown]
# ## 3. The app
#
# Building Next.js on a 2-vCPU Kaggle kernel takes 10–15 minutes. The fast path
# is a prebuilt artifact in a Kaggle dataset (`<dataset>/app/server.js`, made by
# `deploy/scripts/package-kaggle-app.sh`); without one this cell builds from
# source. Either way the client assets are copied into the standalone tree,
# because `next build` does not do that itself.

# %%
def find_app_artifact() -> Path | None:
    if (APP_DIR / "server.js").is_file():
        return APP_DIR
    configured = Path(os.environ.get("KELASKA_APP_ARTIFACT_DIR", "") or "")
    if (configured / "server.js").is_file():
        return configured
    root = Path("/kaggle/input")
    if root.is_dir():
        for candidate in sorted(root.iterdir()):
            if (candidate / "app" / "server.js").is_file():
                return candidate / "app"
    return None


def install_dependencies(bun: str) -> None:
    env = os.environ.copy()
    # Kaggle's GitHub egress answers 404 for the onnxruntime CUDA asset; the
    # CPU/WebGPU build is enough for this app.
    env["ONNXRUNTIME_NODE_INSTALL_CUDA"] = "skip"
    args = ["install", "--no-progress"]
    if (SRC_DIR / "bun.lock").is_file():
        args.append("--frozen-lockfile")
    if run(bun, *args, check=False, cwd=SRC_DIR, env=env, logfile=LOG_DIR / "install.log").returncode:
        log("bun install failed; retrying without --frozen-lockfile")
        if run(bun, "install", "--no-progress", check=False, cwd=SRC_DIR, env=env,
               logfile=LOG_DIR / "install.log").returncode:
            log("bun install still failed; installing without lifecycle scripts")
            run(bun, "install", "--no-progress", "--ignore-scripts", check=True, cwd=SRC_DIR,
                env=env, logfile=LOG_DIR / "install.log")
            run(bun, "run", "build:packages", check=True, cwd=SRC_DIR, env=env,
                logfile=LOG_DIR / "install.log")


def build_app(bun: str) -> Path:
    env = os.environ.copy()
    env["STATIC_UI"] = "0"
    env["NODE_ENV"] = "production"
    # A deployment build does not need the TypeScript pass; it costs ~2.5 min
    # on this box and the branch is type-checked on the host before pushing.
    env.setdefault("OPENMAIC_SKIP_TYPECHECK", "1")
    env.setdefault("NODE_OPTIONS", "--max-old-space-size=10240")

    install_dependencies(bun)
    run(bun, "run", "build", check=True, cwd=SRC_DIR, env=env, logfile=LOG_DIR / "build.log")

    standalone = SRC_DIR / ".next/standalone"
    if not (standalone / "server.js").is_file():
        raise SystemExit(f"build produced no standalone server: {standalone}")
    for name in (".next/static", "public"):
        source = SRC_DIR / name
        target = standalone / name
        if not source.exists():
            raise SystemExit(f"build produced no {name}")
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source, target)
    return standalone


def prepare_app(bun: str) -> Path:
    artifact = find_app_artifact()
    if artifact:
        log(f"using prebuilt app artifact: {artifact}")
        if artifact == APP_DIR:
            return APP_DIR
        if APP_DIR.exists():
            shutil.rmtree(APP_DIR)
        shutil.copytree(artifact, APP_DIR)
        return APP_DIR

    log("no prebuilt artifact found; building the app in this kernel")
    standalone = build_app(bun)
    if APP_DIR.exists():
        shutil.rmtree(APP_DIR)
    shutil.copytree(standalone, APP_DIR)
    return APP_DIR


# %% [markdown]
# ## 4. GPU services
#
# On a CPU-only session this cell returns immediately and the app uses
# `openmaic.cpu.yml` (browser-native narration, no image slot). On a GPU session
# `scripts/gpu-services.sh` installs and starts ComfyUI, FunASR and VoxCPM2 on
# the two T4s. Ollama is deliberately skipped: chat runs on Gemini and a
# resident local model would compete for the same VRAM as TTS/ASR. The shipped
# `openmaic.kaggle.yml` assigns `agent.title` to Ollama, so the kernel removes
# that line when Ollama is not started and conversation titles follow `agent`
# on Gemini. Set `KELASKA_GPU_SERVICES=comfyui,funasr,voxcpm,ollama` to keep
# the local title model instead.

# %%
def detect_model_cache() -> None:
    """Point gpu-services.sh at the private model dataset when attached."""
    root = Path("/kaggle/input")
    if not root.is_dir():
        return
    for candidate in sorted(root.iterdir()):
        if any(
            (candidate / name).is_dir() for name in ("comfyui", "hf", "models", "ollama")
        ):
            os.environ["GPU_MODEL_CACHE"] = str(candidate)
            log(f"GPU model cache: {candidate}")
            return


def start_gpu_services() -> None:
    if not has_gpu():
        log("no NVIDIA GPU; CPU-only mode (GPU services and media slots skipped)")
        return
    detect_model_cache()
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
        capture_output=True,
        text=True,
        check=False,
    )
    log("GPUs:\n" + result.stdout.strip())

    GPU_DIR.mkdir(parents=True, exist_ok=True)
    log("installing/starting GPU services (10+ minutes on a cold kernel)")
    run(
        "bash",
        "scripts/gpu-services.sh",
        "--dir",
        str(GPU_DIR),
        "--only",
        ",".join(GPU_SERVICES),
        check=False,
        cwd=SRC_DIR,
        logfile=LOG_DIR / "gpu-services.log",
    )
    state = GPU_DIR / "gpu-services.env"
    if state.is_file():
        log(state.read_text(encoding="utf-8").strip())


def start_gpu_proxy() -> None:
    """Backend for the gpu. tunnel: 127.0.0.1:8790 -> local GPU services."""
    routes = (
        ("/comfyui", "http://127.0.0.1:8188"),
        ("/tts", "http://127.0.0.1:8001"),
        ("/asr", "http://127.0.0.1:8000"),
        ("/ollama", "http://127.0.0.1:11434"),
    )

    class ProxyHandler(BaseHTTPRequestHandler):
        def _forward(self) -> None:
            path = self.path
            target = next(
                (base + path[len(prefix) :] for prefix, base in routes if path.startswith(prefix)),
                None,
            )
            if not target:
                self.send_error(404, "unknown GPU route")
                return
            length = int(self.headers.get("content-length") or 0)
            body = self.rfile.read(length) if length else None
            headers = {
                key: value
                for key, value in self.headers.items()
                if key.lower() not in {"host", "content-length", "connection"}
            }
            request = urllib.request.Request(target, data=body, method=self.command, headers=headers)
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    payload = response.read()
                    self.send_response(response.status)
                    for key, value in response.headers.items():
                        if key.lower() not in {"content-length", "transfer-encoding", "connection"}:
                            self.send_header(key, value)
                    self.send_header("content-length", str(len(payload)))
                    self.end_headers()
                    if self.command != "HEAD":
                        self.wfile.write(payload)
            except Exception as error:  # noqa: BLE001 - surface the upstream failure
                self.send_error(502, str(error))

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = _forward

        def log_message(self, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", PROXY_PORT), ProxyHandler)
    import threading

    threading.Thread(target=server.serve_forever, name="gpu-proxy", daemon=True).start()
    log(f"GPU reverse proxy listening on 127.0.0.1:{PROXY_PORT}")


# %% [markdown]
# ## 5. Start the app and the tunnel
#
# The tunnel token is optional. With it, a named tunnel keeps the same hostname
# forever; without it, `cloudflared` creates a random `*.trycloudflare.com`
# URL that changes on every restart.

# %%
def start_app(app_dir: Path, bun: str) -> subprocess.Popen:
    log(f"starting the standalone app on 127.0.0.1:{APP_PORT}")
    logfile = (LOG_DIR / "app.log").open("ab")
    child = subprocess.Popen(
        [bun, "server.js"],
        cwd=str(app_dir),
        env=os.environ.copy(),
        stdout=logfile,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
    )
    CHILDREN.append(child)
    for _ in range(120):
        if port_open(APP_PORT):
            log("app is listening")
            return child
        if child.poll() is not None:
            raise SystemExit("app exited during startup; see logs/app.log")
        time.sleep(1)
    raise SystemExit("app did not open :3000 in 120 s; see logs/app.log")


def download_cloudflared() -> Path:
    binary = Path("/usr/local/bin/cloudflared")
    if binary.is_file():
        return binary
    arch = "amd64" if os.uname().machine in {"x86_64", "amd64"} else "arm64"
    url = f"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-{arch}"
    target = Path("/kaggle/temp/cloudflared")
    for attempt in range(3):
        try:
            urllib.request.urlretrieve(url, target)
            target.chmod(0o755)
            return target
        except Exception as error:
            if attempt == 2:
                raise
            log(f"cloudflared download attempt {attempt + 1} failed: {error}; retrying")
            time.sleep(5)
    raise SystemExit("cloudflared could not be downloaded")


def start_tunnel() -> None:
    global TUNNEL_URL
    binary = download_cloudflared()
    token = secret(
        "KELASKA_GPU_TUNNEL_TOKEN" if IS_WORKER else "KELASKA_APP_TUNNEL_TOKEN",
        retries=0,
    )
    logfile = LOG_DIR / "cloudflared.log"
    if token:
        log("starting the named Cloudflare tunnel")
        command = [str(binary), "tunnel", "--no-autoupdate", "run", "--token", token]
        child = subprocess.Popen(
            command,
            stdout=open(logfile, "ab"),
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
        )
        CHILDREN.append(child)
        time.sleep(5)
        if child.poll() is not None:
            raise SystemExit("cloudflared exited immediately; see logs/cloudflared.log")
        TUNNEL_URL = os.environ.get(
            "KELASKA_GPU_PUBLIC_URL" if IS_WORKER else "KELASKA_APP_PUBLIC_URL", ""
        ).strip().rstrip("/")
        if TUNNEL_URL:
            log(f"public URL: {TUNNEL_URL}")
        elif IS_WORKER:
            log("GPU worker tunnel started (gpu. hostname configured in Cloudflare)")
        else:
            log("named tunnel started; set KAGGLE_ORIGIN in Vercel to its hostname")
        return

    log("starting a quick Cloudflare tunnel (the URL changes on every restart)")
    child = subprocess.Popen(
        [str(binary), "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{APP_PORT}"],
        stdout=open(logfile, "ab"),
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
    )
    CHILDREN.append(child)
    deadline = time.time() + 90
    while time.time() < deadline:
        text = logfile.read_text(encoding="utf-8", errors="replace") if logfile.is_file() else ""
        for token_part in text.split():
            if token_part.startswith("https://") and ".trycloudflare.com" in token_part:
                TUNNEL_URL = token_part.strip().rstrip("/")
                log(f"public app URL: {TUNNEL_URL}")
                log("set KAGGLE_ORIGIN to this URL in Vercel, then redeploy")
                return
        if child.poll() is not None:
            raise SystemExit("cloudflared exited immediately; see logs/cloudflared.log")
        time.sleep(3)
    log("tunnel URL not detected yet; watch logs/cloudflared.log")


# %% [markdown]
# ## 6. Health check and keep-alive
#
# Kaggle stops a session with SIGTERM; the loop exits cleanly so the tunnel and
# the GPU service PIDs are released before Kaggle force-kills the kernel.

# %%
def app_health() -> dict:
    request = urllib.request.Request(
        f"http://127.0.0.1:{APP_PORT}/api/health",
        headers={"accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_app() -> None:
    for _ in range(60):
        try:
            payload = app_health()
            if payload.get("success"):
                log(f"app health: {payload}")
                return
        except Exception as error:
            log(f"health check not ready: {error}")
        time.sleep(2)
    log("app did not answer /api/health; check logs/app.log")


def cleanup(signum=None, frame=None) -> None:
    global CLEANED
    if CLEANED:
        return
    CLEANED = True
    log("shutting down the app, the tunnel and the GPU services")
    for child in CHILDREN:
        if child.poll() is None:
            child.send_signal(signal.SIGTERM)
    for child in CHILDREN:
        try:
            child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            child.kill()
    for pid_file in (GPU_DIR / "pids").glob("*.pid"):
        try:
            os.kill(int(pid_file.read_text(encoding="utf-8").strip()), signal.SIGTERM)
        except (ValueError, OSError, FileNotFoundError):
            pass


def request_stop(signum=None, frame=None) -> None:
    global STOP_REQUESTED
    STOP_REQUESTED = True
    log(f"received signal {signum}; stopping after this interval")


# %%
def publish_models() -> None:
    """One-time warmup: publish the downloaded GPU weights to a private dataset."""
    if os.environ.get("KELASKA_PUBLISH_MODELS", "").strip().lower() not in {"1", "true"}:
        return
    import json as _json

    log("publishing GPU model cache to the private Kaggle dataset")
    stage = Path("/kaggle/working/kelaska-models-publish")
    if stage.exists():
        shutil.rmtree(stage)
    for relative in ("comfyui/models/checkpoints", "hf", "modelscope", "ollama"):
        source = GPU_DIR / relative
        target = stage / relative
        if source.is_dir():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(source, target)
    (stage / "dataset-metadata.json").write_text(
        _json.dumps(
            {
                "title": "KelasKA GPU Models",
                "id": "akjdev/kelaska-gpu-models",
                "licenses": [{"name": "CC0-1.0"}],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    try:
        import kaggle  # noqa: F401 - Kaggle images ship the CLI
    except ImportError:
        run(sys.executable, "-m", "pip", "install", "-q", "kaggle", check=False)
    run(
        "kaggle",
        "datasets",
        "version",
        "-p",
        str(stage),
        "-r",
        "tar",
        "-m",
        "refresh GPU weights",
        "-q",
        check=False,
    )
    log("GPU model cache published (or version failed; check Kaggle dataset)")


def main() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    unpack_staged()
    bun = install_bun()
    clone_repo()
    prepare_environment()
    if IS_WORKER and not has_gpu():
        raise SystemExit("gpu-worker requested but this Kaggle session has no GPU")
    start_gpu_services()
    if IS_WORKER:
        publish_models()
        start_gpu_proxy()
    else:
        app_dir = prepare_app(bun)
        start_app(app_dir, bun)
        wait_for_app()
    start_tunnel()

    log("")
    log("=" * 72)
    if IS_WORKER:
        log("KelasKA GPU worker is running (no app, no DB pool).")
    else:
        log("KelasKA compute node is running.")
    if TUNNEL_URL:
        log(f"  public URL: {TUNNEL_URL}")
    if not IS_WORKER:
        log(f"  KAGGLE_PROXY_TOKEN=<same as KELASKA_PROXY_TOKEN>")
        log(f"  health: http://127.0.0.1:{APP_PORT}/api/health")
    log("=" * 72)

    started_at = time.time()
    while not STOP_REQUESTED:
        if time.time() - started_at > MAX_RUNTIME_SECONDS:
            log("maximum runtime reached; exiting to free the quota")
            break
        if not IS_WORKER:
            try:
                payload = app_health()
                log(
                    f"health: {payload.get('status', '?')} "
                    f"tts={payload.get('capabilities', {}).get('tts')}"
                )
            except Exception as error:
                log(f"health check failed: {error}")
        for _ in range(60):
            if STOP_REQUESTED:
                break
            time.sleep(1)
    cleanup()


if __name__ == "__main__":
    try:
        main()
    finally:
        cleanup()

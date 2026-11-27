# %% [markdown]
# # KelasKA — Kaggle compute node for the Vercel UI
#
# This notebook turns a **Kaggle GPU session (2× T4)** into the compute half of
# the split deployment:
#
# - the full Next.js app (API + generation engine) runs on `127.0.0.1:3000`;
# - ComfyUI (images), VoxCPM2 (TTS) and FunASR (ASR) run on the same box;
# - one Cloudflare Tunnel publishes the app;
# - the Vercel project (`deploy/vercel` branch) serves the static UI and proxies
#   every `/api/*` call here.
#
# ## Before you run
#
# 1. **Settings → Accelerator → GPU T4 x2** (the notebook needs two T4s; the
#    `nvidia-smi` check below refuses to continue otherwise).
# 2. **Kaggle → Add-ons → Secrets** (the notebook reads them; never paste them
#    into a cell):
#
# | Secret | Required | Meaning |
# | --- | --- | --- |
# | `KELASKA_ENV_B64` | yes | `base64 -w0 .env.local` of the app environment (Supabase, database, Gemini, secrets) |
# | `KELASKA_AUTH_PUBLIC_URL` | yes with accounts | the Vercel production URL, e.g. `https://kelaska.vercel.app` |
# | `KELASKA_PROXY_TOKEN` | strongly recommended | shared secret the Vercel rewrite injects; without it the tunnel is open |
# | `KELASKA_APP_TUNNEL_TOKEN` | recommended | Cloudflare **named** tunnel token for a stable hostname |
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


def clone_repo() -> None:
    token = secret("KELASKA_GITHUB_TOKEN", retries=0)
    url = REPO_URL
    if token and url.startswith("https://github.com/"):
        url = url.replace("https://", f"https://x-access-token:{token}@", 1)

    LOG_DIR.mkdir(parents=True, exist_ok=True)
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
        shipped = SRC_DIR / "deploy/kaggle/openmaic.kaggle.yml"
        if not shipped.is_file():
            raise SystemExit(f"missing {shipped}")
        shutil.copy2(shipped, SRC_DIR / "openmaic.yml")
        log("openmaic.yml copied from deploy/kaggle/openmaic.kaggle.yml")
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
# `scripts/gpu-services.sh` installs and starts ComfyUI, FunASR and VoxCPM2 on
# the two T4s. Ollama is deliberately skipped: chat runs on Gemini and a
# resident local model would compete for the same VRAM as TTS/ASR.

# %%
def start_gpu_services() -> None:
    if not shutil.which("nvidia-smi"):
        raise SystemExit(
            "No NVIDIA GPU. Set Settings → Accelerator → GPU T4 x2 and rerun the notebook."
        )
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
    token = secret("KELASKA_APP_TUNNEL_TOKEN", retries=0)
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
        TUNNEL_URL = os.environ.get("KELASKA_APP_PUBLIC_URL", "").strip().rstrip("/")
        if TUNNEL_URL:
            log(f"public app URL: {TUNNEL_URL}")
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
def main() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    bun = install_bun()
    clone_repo()
    prepare_environment()
    start_gpu_services()
    app_dir = prepare_app(bun)
    start_app(app_dir, bun)
    wait_for_app()
    start_tunnel()

    log("")
    log("=" * 72)
    log("KelasKA compute node is running.")
    if TUNNEL_URL:
        log(f"  KAGGLE_ORIGIN={TUNNEL_URL}")
    log(f"  KAGGLE_PROXY_TOKEN=<same as KELASKA_PROXY_TOKEN>")
    log(f"  health: http://127.0.0.1:{APP_PORT}/api/health")
    log("=" * 72)

    started_at = time.time()
    while not STOP_REQUESTED:
        if time.time() - started_at > MAX_RUNTIME_SECONDS:
            log("maximum runtime reached; exiting to free the GPU quota")
            break
        try:
            payload = app_health()
            log(f"health: {payload.get('status', '?')} tts={payload.get('capabilities', {}).get('tts')}")
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

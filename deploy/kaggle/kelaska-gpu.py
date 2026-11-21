"""
KelasKA GPU kernel — runs the GPU services on a Kaggle 2x T4 box.

The Cloudflare Worker pushes this file as a new version of a private Kaggle
script kernel and starts it when a generation asks for a GPU. The kernel:

  1. clones this repo (for scripts/gpu-services.sh and the gpu_servers adapters),
  2. links/copies a prepared model dataset into /kaggle/temp/gpu-models,
  3. starts ComfyUI, FunASR, VoxCPM2 and Ollama through gpu-services.sh,
  4. exposes them on one Cloudflare Tunnel with path routing
     (/comfyui, /asr, /tts, /ollama, /health),
  5. polls the Worker's lease endpoint and exits itself when the Worker stops
     it or the box has been idle, so the weekly GPU quota is not burned by a
     warm tunnel with no traffic.

Required Kaggle Secrets (Secrets -> Add new secret):
  KELASKA_GPU_TUNNEL_TOKEN   token of the named Cloudflare Tunnel for gpu.
  KELASKA_GPU_LEASE_KEY      same value as the Worker's GPU_LEASE_KEY.

Optional Kaggle Secrets / environment:
  KELASKA_REPO_URL           default https://github.com/ade-karya/KelasKA.git
  KELASKA_REPO_REF           default Colab
  KELASKA_GPU_SERVICES       default comfyui,funasr,voxcpm,ollama
  KELASKA_GPU_DATASET_DIR    default: first /kaggle/input/* with model dirs
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_URL = os.environ.get("KELASKA_REPO_URL", "https://github.com/ade-karya/KelasKA.git")
REPO_REF = os.environ.get("KELASKA_REPO_REF", "Colab")
SRC_DIR = Path(os.environ.get("KELASKA_SRC_DIR", "/kaggle/temp/KelasKA-src"))
GPU_DIR = Path(os.environ.get("KELASKA_GPU_DIR", "/kaggle/temp/gpu-models"))
LEASE_URL = os.environ.get(
    "KELASKA_GPU_LEASE_URL", "https://kelaska.riau.ai/__kelaska/gpu/lease"
)
LEASE_SECONDS = int(os.environ.get("KELASKA_GPU_LEASE_SECONDS", "60"))
MAX_RUNTIME_SECONDS = int(os.environ.get("KELASKA_GPU_MAX_RUNTIME", "42000"))  # 11h40m
PROXY_PORT = int(os.environ.get("KELASKA_GPU_PROXY_PORT", "8790"))
SERVICES = [
    name.strip()
    for name in os.environ.get("KELASKA_GPU_SERVICES", "comfyui,funasr,voxcpm,ollama").split(",")
    if name.strip()
]
PORTS = {"comfyui": 8188, "funasr": 8000, "voxcpm": 8001, "ollama": 11434}

CHILDREN: list[subprocess.Popen] = []
READY = False


def log(message: str) -> None:
    print(f"[kelaska-gpu] {time.strftime('%H:%M:%S')} {message}", flush=True)


def secret(name: str, default: str = "") -> str:
    value = os.environ.get(name, "")
    if value:
        return value
    # The secrets service can be briefly unavailable right after a new kernel
    # starts. Retry a few times before giving up; a transient connection error
    # must not waste the whole GPU session.
    for attempt in range(6):
        try:
            from kaggle_secrets import UserSecretsClient  # type: ignore

            value = UserSecretsClient().get_secret(name) or default
            if value:
                return value
        except Exception as error:  # local dry run without the Kaggle runtime
            if attempt == 5:
                log(f"secret {name} unavailable: {error}")
            else:
                log(f"secret {name} attempt {attempt + 1} failed: {error}; retrying")
        time.sleep(3)
    return default


def run(
    *args: str,
    check: bool = True,
    cwd: Path | None = None,
    logfile: Path | None = None,
) -> subprocess.CompletedProcess:
    log("$ " + " ".join(args))
    sink = open(logfile, "ab") if logfile else subprocess.DEVNULL
    try:
        return subprocess.run(
            args, check=check, cwd=str(cwd) if cwd else None, stdout=sink, stderr=subprocess.STDOUT
        )
    finally:
        if logfile:
            sink.close()


def port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def find_dataset_dir() -> Path | None:
    configured = os.environ.get("KELASKA_GPU_DATASET_DIR")
    if configured:
        return Path(configured) if Path(configured).is_dir() else None
    root = Path("/kaggle/input")
    if not root.is_dir():
        return None
    for candidate in sorted(root.iterdir()):
        if (candidate / "comfyui").is_dir() or (candidate / "ollama").is_dir():
            return candidate
    return None


# ------------------------------------------------------------------ repo
def prepare_repo() -> None:
    if (SRC_DIR / ".git").is_dir():
        run("git", "-C", str(SRC_DIR), "fetch", "origin", REPO_REF, logfile=GPU_DIR / "logs" / "git.log")
        run(
            "git", "-C", str(SRC_DIR), "reset", "--hard", f"origin/{REPO_REF}",
            logfile=GPU_DIR / "logs" / "git.log",
        )
        return
    SRC_DIR.parent.mkdir(parents=True, exist_ok=True)
    run(
        "git", "clone", "--depth", "1", "--branch", REPO_REF, REPO_URL, str(SRC_DIR),
        logfile=GPU_DIR / "logs" / "git.log",
    )


def prepare_models() -> None:
    dataset = find_dataset_dir()
    if not dataset:
        log("no prepared model dataset found; gpu-services.sh will download weights")
        return
    log(f"model dataset: {dataset}")
    (GPU_DIR / "logs").mkdir(parents=True, exist_ok=True)
    os.environ["GPU_MODEL_CACHE"] = str(dataset)


def start_services() -> None:
    args = [
        "bash", "scripts/gpu-services.sh",
        "--dir", str(GPU_DIR),
        "--only", ",".join(SERVICES),
    ]
    log("installing/starting GPU services (this can take 10+ minutes on a cold kernel)")
    result = run(*args, check=False, cwd=SRC_DIR, logfile=GPU_DIR / "logs" / "gpu-services.log")
    if result.returncode != 0:
        log(f"gpu-services.sh exited {result.returncode}; see logs/gpu-services.log")
    state = GPU_DIR / "gpu-services.env"
    if state.exists():
        log(state.read_text(encoding="utf-8").strip())


# ------------------------------------------------------------------ proxy
def make_proxy_app():
    try:
        from aiohttp import ClientSession, ClientTimeout, web
    except ImportError:
        # Kaggle images normally ship aiohttp. If an image does not, installing
        # it here is a few seconds compared with the model downloads above.
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "aiohttp"], check=True)
        from aiohttp import ClientSession, ClientTimeout, web

    PREFIX_PORTS = {
        "/comfyui": PORTS["comfyui"],
        "/tts": PORTS["voxcpm"],
        "/asr": PORTS["funasr"],
        "/ollama": PORTS["ollama"],
    }

    async def health(request):
        services = {name: port_open(port) for name, port in PORTS.items() if name in SERVICES}
        response = {
            "ok": READY,
            "ready": READY,
            "port": PROXY_PORT,
            "services": services,
            "time": int(time.time()),
        }
        return web.json_response(response, status=200 if READY else 503)

    async def forward(request):
        path = request.path
        prefix = next(
            (candidate for candidate in PREFIX_PORTS if path == candidate or path.startswith(candidate + "/")),
            None,
        )
        if prefix is None:
            return web.json_response({"ok": False, "error": "unknown GPU path"}, status=404)
        suffix = path[len(prefix):] or "/"
        target = f"http://127.0.0.1:{PREFIX_PORTS[prefix]}{suffix}"
        if request.query_string:
            target += "?" + request.query_string

        headers = {
            name: value
            for name, value in request.headers.items()
            if name.lower() not in {"host", "content-length", "cf-access-client-id", "cf-access-client-secret"}
        }
        headers["x-kelaska-gpu-proxy"] = "1"
        body = await request.read() if request.method not in {"GET", "HEAD"} else None
        timeout = ClientTimeout(total=900, connect=10)
        session: ClientSession = request.app["session"]
        try:
            async with session.request(
                request.method, target, headers=headers, data=body, timeout=timeout
            ) as upstream:
                response_headers = {
                    name: value
                    for name, value in upstream.headers.items()
                    if name.lower() not in {"transfer-encoding", "content-encoding", "content-length"}
                }
                return web.Response(
                    body=await upstream.read(), status=upstream.status, headers=response_headers
                )
        except Exception as error:
            log(f"proxy {request.method} {path} -> {target}: {error}")
            return web.json_response({"ok": False, "error": str(error)}, status=502)

    app = web.Application(client_max_size=256 * 1024 * 1024)
    app["session"] = None
    app.router.add_get("/health", health)
    app.router.add_get("/healthz", health)
    for prefix in PREFIX_PORTS:
        app.router.add_route("*", prefix, forward)
        app.router.add_route("*", prefix + "/{tail:.*}", forward)

    async def on_startup(app):
        app["session"] = ClientSession()

    async def on_cleanup(app):
        session = app.get("session")
        if session:
            await session.close()

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


def start_proxy() -> None:
    from aiohttp import web

    log(f"starting GPU reverse proxy on 127.0.0.1:{PROXY_PORT}")
    web.run_app(make_proxy_app(), host="127.0.0.1", port=PROXY_PORT, print=None)


def start_tunnel(token: str) -> None:
    binary = Path("/usr/local/bin/cloudflared")
    if not binary.exists():
        arch = "amd64" if os.uname().machine in {"x86_64", "amd64"} else "arm64"
        url = f"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-{arch}"
        log("downloading cloudflared")
        urllib.request.urlretrieve(url, "/kaggle/temp/cloudflared")
        binary = Path("/kaggle/temp/cloudflared")
        binary.chmod(0o755)
    log("starting cloudflared tunnel for gpu.kelaska.riau.ai")
    logfile = (GPU_DIR / "logs" / "cloudflared.log").open("ab")
    child = subprocess.Popen(
        [str(binary), "tunnel", "--no-autoupdate", "run", "--token", token],
        stdout=logfile,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
    )
    CHILDREN.append(child)
    time.sleep(5)
    if child.poll() is not None:
        raise RuntimeError("cloudflared exited immediately; see logs/cloudflared.log")


# ------------------------------------------------------------------ lease
def lease(lease_key: str) -> dict:
    request = urllib.request.Request(
        LEASE_URL,
        headers={"x-kelaska-gpu-key": lease_key, "accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def cleanup(signum=None, frame=None) -> None:
    log("shutting down GPU services and tunnel")
    for child in CHILDREN:
        if child.poll() is None:
            child.send_signal(signal.SIGTERM)
    for child in CHILDREN:
        try:
            child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            child.kill()
    # gpu-services.sh leaves one pid file per service. Kill only those PIDs;
    # a broad `pkill -f` would also match the kernel process itself.
    for pid_file in (GPU_DIR / "pids").glob("*.pid"):
        try:
            pid = int(pid_file.read_text(encoding="utf-8").strip())
            os.kill(pid, signal.SIGTERM)
        except (ValueError, OSError, FileNotFoundError):
            pass


def main() -> None:
    global READY
    started_at = time.time()
    (GPU_DIR / "logs").mkdir(parents=True, exist_ok=True)

    tunnel_token = secret("KELASKA_GPU_TUNNEL_TOKEN")
    lease_key = secret("KELASKA_GPU_LEASE_KEY")
    if not tunnel_token or not lease_key:
        raise SystemExit(
            "KELASKA_GPU_TUNNEL_TOKEN and KELASKA_GPU_LEASE_KEY must be set as Kaggle Secrets"
        )

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    prepare_repo()
    prepare_models()
    start_services()

    import threading

    threading.Thread(target=start_proxy, name="gpu-proxy", daemon=True).start()
    for _ in range(30):
        if port_open(PROXY_PORT):
            break
        time.sleep(1)
    READY = all(port_open(PORTS[name]) for name in SERVICES) or any(
        port_open(PORTS[name]) for name in SERVICES
    )
    log(f"services ready: {READY}")

    start_tunnel(tunnel_token)

    log(f"entering lease loop ({LEASE_SECONDS}s); lease endpoint {LEASE_URL}")
    while True:
        if time.time() - started_at > MAX_RUNTIME_SECONDS:
            log("maximum runtime reached; exiting to free GPU quota")
            break
        if not READY and all(port_open(PORTS[name]) for name in SERVICES):
            READY = True
            log("all services became ready")
        try:
            answer = lease(lease_key)
            if not answer.get("keepAlive", True):
                log(f"Worker asked to stop: {answer.get('reason')}")
                break
        except Exception as error:
            # A Worker outage must not strand a GPU box forever; the max
            # runtime above is the backstop. Keep serving while it is down.
            log(f"lease check failed (continuing): {error}")
        time.sleep(LEASE_SECONDS)

    cleanup()


if __name__ == "__main__":
    try:
        main()
    finally:
        cleanup()

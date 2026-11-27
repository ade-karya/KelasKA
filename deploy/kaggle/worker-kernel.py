"""
KelasKA worker kernel — full app + generation runner + GPU, started from Vercel.

Vercel serves the UI and the DB-backed APIs, but a serverless function cannot
run the generation runner. When a run is created (or a paused run is
confirmed/retried), the Vercel API pushes this script as a new version of a
private Kaggle kernel and starts it. The kernel:

  1. writes `.env.local` from the KELASKA_ENV_B64 Kaggle Secret and pins the
     Kaggle-specific runtime values (direct DB port, worker profile),
  2. clones this repo's `deploy/kaggle` branch,
  3. selects the GPU or CPU model config from `deploy/kaggle/openmaic*.yml`,
  4. runs `deploy/kaggle/run.sh` (install.sh --kaggle: full app + runner + GPU),
  5. waits for `/api/health`, then polls the internal `/api/worker/status`
     endpoint and exits when the queue has been empty for a while, so the
     weekly GPU quota is not burned by an idle session.

Required Kaggle Secrets (Secrets -> Add new secret):
  KELASKA_ENV_B64            base64 of the production .env.local. It must
                             contain the same DATABASE_URL and
                             OPENMAIC_SECRET_KEY as Vercel, plus
                             WORKER_STATUS_TOKEN and GOOGLE_API_KEY.
  KELASKA_WORKER_STATUS_TOKEN optional override; otherwise read from the env.

Optional Kaggle Secrets:
  KELASKA_OPENMAIC_YML_B64   override the model config (${VAR} refs only).
  KELASKA_REPO_URL           default https://github.com/ade-karya/KelasKA.git
  KELASKA_REPO_REF           default deploy/kaggle
  KELASKA_WORKER_IDLE_SECONDS  default 600 (10 min of no claimable/active runs)
  KELASKA_WORKER_MAX_RUNTIME   default 42000 (11h40m; below Kaggle's 12h cap)
  KELASKA_WORKER_POLL_SECONDS  default 30
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

REPO_URL = os.environ.get("KELASKA_REPO_URL", "https://github.com/ade-karya/KelasKA.git")
REPO_REF = os.environ.get("KELASKA_REPO_REF", "deploy/kaggle")
REPO_DIR = Path(os.environ.get("KELASKA_REPO_DIR", "/kaggle/temp/KelasKA"))
IDLE_SECONDS = int(os.environ.get("KELASKA_WORKER_IDLE_SECONDS", "600"))
MAX_RUNTIME_SECONDS = int(os.environ.get("KELASKA_WORKER_MAX_RUNTIME", "42000"))
POLL_SECONDS = max(5, int(os.environ.get("KELASKA_WORKER_POLL_SECONDS", "30")))
STATUS_URL = os.environ.get("KELASKA_WORKER_STATUS_URL", "http://127.0.0.1:3000/api/worker/status")
HEALTH_URL = os.environ.get("KELASKA_WORKER_HEALTH_URL", "http://127.0.0.1:3000/api/health")
APP_PORT = 3000

STOP_REQUESTED = False


def log(message: str) -> None:
    print(f"[kelaska-worker] {time.strftime('%H:%M:%S')} {message}", flush=True)


def handle_signal(signum: int, _frame: object) -> None:
    global STOP_REQUESTED
    STOP_REQUESTED = True
    log(f"received signal {signum}; shutting down after this poll")


signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)


def secret(name: str, default: str = "", retries: int = 6) -> str:
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
            elif attempt == 0:
                log(f"secret {name} attempt {attempt + 1} failed: {error}; retrying")
        time.sleep(3)
    return default


def run(args: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    log("$ " + " ".join(args))
    return subprocess.run(
        args,
        check=check,
        cwd=str(cwd) if cwd else None,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )


def decode_b64(value: str, label: str) -> str:
    try:
        return base64.b64decode(value + "=" * (-len(value) % 4), validate=False).decode("utf-8")
    except Exception as error:
        raise RuntimeError(f"{label} is not valid base64: {error}") from error


def parse_env(text: str) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key:
            env[key] = value
    return env


def quote_env(value: str) -> str:
    if any(char.isspace() for char in value) or "#" in value:
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value


def write_env(path: Path, env: dict[str, str]) -> None:
    lines = ["# Written by deploy/kaggle/worker-kernel.py", "# Secrets come from Kaggle Secrets / .env.local."]
    for key in sorted(env):
        lines.append(f"{key}={quote_env(env[key])}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    path.chmod(0o600)


def has_gpu() -> bool:
    if shutil.which("nvidia-smi") is None:
        return False
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0 and result.stdout.strip():
            log(f"GPU: {result.stdout.strip().splitlines()[0]}")
            return True
    except Exception as error:
        log(f"nvidia-smi probe failed: {error}")
    log("No NVIDIA GPU visible; using the CPU model config")
    return False


def clone_repo() -> None:
    if (REPO_DIR / ".git").is_dir():
        run(["git", "fetch", "--depth", "1", "origin", REPO_REF], cwd=REPO_DIR, check=False)
        run(["git", "checkout", "-f", "FETCH_HEAD"], cwd=REPO_DIR)
        return
    if REPO_DIR.exists():
        shutil.rmtree(REPO_DIR)
    REPO_DIR.parent.mkdir(parents=True, exist_ok=True)
    run(["git", "clone", "--depth", "1", "--branch", REPO_REF, REPO_URL, str(REPO_DIR)])


def prepare_files() -> str:
    raw_env = secret("KELASKA_ENV_B64")
    if not raw_env:
        raise RuntimeError("Kaggle Secret KELASKA_ENV_B64 is required (base64 of .env.local)")
    env = parse_env(decode_b64(raw_env, "KELASKA_ENV_B64"))

    # Long-lived worker: use the direct/session pooler so NOTIFY and leases
    # are not split across pgbouncer transactions. The transaction pooler
    # (6543) is what Vercel uses; both point at the same database.
    dsn = env.get("DATABASE_URL", "")
    if ":6543/" in dsn:
        env["DATABASE_URL"] = dsn.replace(":6543/", ":5432/", 1)

    env["OPENMAIC_DEPLOY_TARGET"] = "kaggle"
    env["OPENMAIC_AGENT_RUNTIME_ENABLED"] = "true"
    env["HOSTNAME"] = "0.0.0.0"
    write_env(REPO_DIR / ".env.local", env)

    override = secret("KELASKA_OPENMAIC_YML_B64", retries=0)
    if override:
        content = decode_b64(override, "KELASKA_OPENMAIC_YML_B64")
        if "providers:" not in content or "slots:" not in content:
            raise RuntimeError("KELASKA_OPENMAIC_YML_B64 does not look like an openmaic.yml")
        (REPO_DIR / "openmaic.yml").write_text(content, encoding="utf-8")
        log("openmaic.yml written from KELASKA_OPENMAIC_YML_B64")
    else:
        template = "openmaic.yml" if has_gpu() else "openmaic.cpu.yml"
        shutil.copyfile(REPO_DIR / "deploy" / "kaggle" / template, REPO_DIR / "openmaic.yml")
        log(f"openmaic.yml selected: {template}")

    return env.get("WORKER_STATUS_TOKEN", "")


def install_app() -> None:
    log("Running deploy/kaggle/run.sh (install.sh --kaggle); this takes several minutes")
    process = subprocess.Popen(
        ["bash", "deploy/kaggle/run.sh"],
        cwd=str(REPO_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert process.stdout is not None
    for line in process.stdout:
        print(f"[install] {line.rstrip()}", flush=True)
    code = process.wait()
    if code != 0:
        raise RuntimeError(f"install.sh --kaggle exited with {code}")


def http_json(url: str, token: str = "", timeout: int = 10) -> dict | None:
    headers = {"Accept": "application/json"}
    if token:
        headers["X-Kelaska-Worker-Token"] = token
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if response.status != 200:
                return None
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, ValueError, TimeoutError) as error:
        log(f"probe {url} failed: {error}")
        return None


def wait_for_app() -> bool:
    for attempt in range(60):
        if STOP_REQUESTED:
            return False
        result = http_json(HEALTH_URL, timeout=5)
        if result and result.get("success"):
            log("App is healthy on :3000")
            return True
        if attempt == 0 or attempt % 12 == 0:
            log(f"Waiting for the app on :3000 (attempt {attempt + 1}/60)")
        time.sleep(5)
    return False


def sleep_slices(seconds: int) -> None:
    for _ in range(seconds):
        if STOP_REQUESTED:
            return
        time.sleep(1)


def monitor(token: str) -> None:
    if not token:
        log("WORKER_STATUS_TOKEN is missing from the env bundle; idle detection is disabled")
    started = time.time()
    last_busy = started
    failures = 0
    while not STOP_REQUESTED:
        if time.time() - started >= MAX_RUNTIME_SECONDS:
            log(f"Reached the {MAX_RUNTIME_SECONDS}s runtime limit; exiting")
            return
        status = http_json(STATUS_URL, token) if token else None
        if status and status.get("success"):
            failures = 0
            claimable = int(status.get("claimable", 0))
            active = int(status.get("active", 0))
            if claimable or active:
                last_busy = time.time()
            elif time.time() - last_busy >= IDLE_SECONDS:
                log(f"Queue empty for {IDLE_SECONDS}s; exiting to free the GPU")
                return
        else:
            failures += 1
            if failures >= 10:
                log("Status endpoint failed 10 times in a row; assuming the app stopped")
                return
        sleep_slices(POLL_SECONDS)


def main() -> int:
    clone_repo()
    token = prepare_files()
    install_app()
    if not wait_for_app():
        log("App never became healthy; exiting")
        return 1
    monitor(token)
    log("KelasKA worker finished")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        log(f"FATAL: {error}")
        sys.exit(1)

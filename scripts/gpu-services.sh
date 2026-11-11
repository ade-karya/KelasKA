#!/usr/bin/env bash
#
# gpu-services.sh — siapkan & jalankan layanan model lokal yang memakai GPU
# NVIDIA untuk OpenMAIC/KelasKA: Ollama (LLM), ComfyUI (gambar), FunASR (ASR)
# dan VoxCPM2 (TTS).
#
# Dipanggil otomatis oleh `install.sh --colab` (atau `install.sh --with-gpu`)
# saat host punya NVIDIA GPU, tetapi juga bisa dijalankan sendiri:
#
#   sudo ./scripts/gpu-services.sh --dir /opt/gpu-models
#   ./scripts/gpu-services.sh --status
#   ./scripts/gpu-services.sh --only ollama,comfyui
#   ./scripts/gpu-services.sh --no-start          # pasang saja, jangan start
#
# Hasil akhir ditulis ke <dir>/gpu-services.env; install.sh membaca file itu
# untuk mengisi .env.local/openmaic.yml hanya dengan layanan yang benar-benar
# merespons health check (endpoint mati tidak boleh masuk konfigurasi).
#
# Model besar disimpan di <dir> (default /opt/gpu-models), BUKAN di repo.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

GPU_DIR="${GPU_MODELS_DIR:-/opt/gpu-models}"
OWNSERVE="${SUDO_USER:-$(id -un)}"
ONLY=""
SKIP=""
START=1
OLLAMA_PORT="${GPU_OLLAMA_PORT:-11434}"
COMFYUI_PORT="${GPU_COMFYUI_PORT:-8188}"
FUNASR_PORT="${GPU_FUNASR_PORT:-8000}"
VOXCPM_PORT="${GPU_VOXCPM_PORT:-8001}"
OLLAMA_MODEL="${GPU_OLLAMA_MODEL:-llama3.2:3b}"
IMAGE_MODEL="${GPU_IMAGE_MODEL:-sd_xl_base_1.0.safetensors}"
SMOKE="${GPU_SMOKE:-0}"
ACTION="install"

info() { printf '[gpu] %s\n' "$*"; }
warn() { printf '[gpu] PERINGATAN: %s\n' "$*" >&2; }
fail() { printf '[gpu] GAGAL: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir=*)        GPU_DIR="${1#*=}" ;;
    --dir)          GPU_DIR="${2:-}"; shift ;;
    --only=*)       ONLY="${1#*=}" ;;
    --only)         ONLY="${2:-}"; shift ;;
    --skip=*)       SKIP="${1#*=}" ;;
    --skip)         SKIP="${2:-}"; shift ;;
    --no-start)     START=0 ;;
    --status)       ACTION="status" ;;
    --smoke)        SMOKE=1 ;;
    --ollama-model=*) OLLAMA_MODEL="${1#*=}" ;;
    --ollama-model)   OLLAMA_MODEL="${2:-}"; shift ;;
    --image-model=*)  IMAGE_MODEL="${1#*=}" ;;
    --image-model)    IMAGE_MODEL="${2:-}"; shift ;;
    --ollama-port=*)  OLLAMA_PORT="${1#*=}" ;;
    --comfyui-port=*) COMFYUI_PORT="${1#*=}" ;;
    --funasr-port=*)  FUNASR_PORT="${1#*=}" ;;
    --voxcpm-port=*)  VOXCPM_PORT="${1#*=}" ;;
    -h|--help)
      sed -n '2,26p' "${BASH_SOURCE[0]}" | sed -E 's/^# ?//'
      exit 0 ;;
    *) fail "argumen tidak dikenal: $1 (lihat --help)" ;;
  esac
  shift
done

GPU_DIR="${GPU_DIR%/}"
STATE_FILE="$GPU_DIR/gpu-services.env"
LOG_DIR="$GPU_DIR/logs"
PID_DIR="$GPU_DIR/pids"
HF_HOME="$GPU_DIR/hf"
MODELSCOPE_CACHE="$GPU_DIR/modelscope"
export HF_HOME MODELSCOPE_CACHE

LAYANAN_URUT=(ollama comfyui funasr voxcpm)

ingin_layanan() {
  local nama="$1"
  if [[ -n "$ONLY" ]]; then
    case ",$ONLY," in *",$nama,"*) ;; *) return 1 ;; esac
  fi
  if [[ -n "$SKIP" ]]; then
    case ",$SKIP," in *",$nama,"*) return 1 ;; esac
  fi
  return 0
}

# ---------------------------------------------------------------- util
port_terbuka() {
  local port="$1" host="${2:-127.0.0.1}"
  (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null
}

wait_http() {
  local url="$1" percobaan="${2:-60}" jeda="${3:-2}" i
  for ((i = 1; i <= percobaan; i++)); do
    if curl -fsS --max-time 10 "$url" >/dev/null 2>&1; then return 0; fi
    sleep "$jeda"
  done
  return 1
}

pid_hidup() {
  local file="$1" pid
  [[ -f "$file" ]] || return 1
  pid="$(cat "$file" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

start_bg() {
  local nama="$1" log="$2"
  shift 2
  local pid_file="$PID_DIR/$nama.pid"
  if pid_hidup "$pid_file"; then
    info "$nama sudah berjalan (PID $(cat "$pid_file"))."
    return 0
  fi
  : >"$log"
  setsid nohup "$@" >>"$log" 2>&1 </dev/null &
  echo $! >"$pid_file"
  info "$nama dimulai (PID $(cat "$pid_file"), log $log)."
}

python_venv() {
  # Buat venv dengan uv bila ada; image Kaggle/Colab sering tanpa ensurepip.
  local dir="$1"
  [[ -x "$dir/bin/python" ]] && return 0
  if command -v uv >/dev/null 2>&1; then
    uv venv "$dir" --system-site-packages --python "$(command -v python3)" >/dev/null 2>&1 \
      && return 0
  fi
  if python3 -m venv --system-site-packages "$dir" >/dev/null 2>&1; then return 0; fi
  return 1
}

pip_install() {
  local venv="$1"
  shift
  if command -v uv >/dev/null 2>&1; then
    VIRTUAL_ENV="$venv" uv pip install "$@"
  else
    "$venv/bin/python" -m pip install --upgrade "$@"
  fi
}

gpu_terdeteksi() {
  command -v nvidia-smi >/dev/null 2>&1 || return 1
  nvidia-smi --query-gpu=index --format=csv,noheader 2>/dev/null | grep -qE '^[0-9]+'
}

jumlah_gpu() {
  nvidia-smi --query-gpu=index --format=csv,noheader 2>/dev/null | grep -cE '^[0-9]+' || true
}

# GPU kedua (bila ada) dipakai VoxCPM+FunASR supaya SDXL dan Ollama tidak
# berebut VRAM 15 GB.
gpu_untuk() {
  local peran="$1" total
  total="$(jumlah_gpu)"
  [[ "$total" =~ ^[0-9]+$ ]] || total=1
  if [[ "$total" -lt 2 ]]; then printf '0'; return; fi
  # SDXL di ComfyUI memakai puncak ~10.6 GiB dari 15 GiB (bobot ~7 GiB saat
  # idle, ~3.6 GiB transient saat sampling), jadi Ollama tidak boleh berbagi
  # GPU 0: satu model 3B (~4 GiB) membuat totalnya ~14.7 GiB dan OOM.
  # GPU 0 = ComfyUI saja; GPU 1 = Ollama + FunASR + VoxCPM (bursty, jarang
  # bersamaan karena judul percakapan hanya dipanggil saat chat).
  case "$peran" in
    comfyui) printf '0' ;;
    *) printf '1' ;;
  esac
}

status_layanan() {
  local nama="$1"
  case "$nama" in
    ollama)  port_terbuka "$OLLAMA_PORT" ;;
    comfyui) port_terbuka "$COMFYUI_PORT" ;;
    funasr)  port_terbuka "$FUNASR_PORT" ;;
    voxcpm)  port_terbuka "$VOXCPM_PORT" ;;
  esac
}

# ---------------------------------------------------------------- layanan
pasang_ollama() {
  local bin="/usr/local/bin/ollama" installer
  if ! command -v ollama >/dev/null 2>&1 && [[ ! -x "$bin" ]]; then
    if ! command -v zstd >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
      info "memasang zstd (dibutuhkan installer Ollama)..."
      apt-get install -y zstd >"$LOG_DIR/apt-zstd.log" 2>&1 \
        || warn "gagal memasang zstd; installer Ollama mungkin gagal."
    fi
    installer="$(mktemp)"
    info "mengunduh installer Ollama..."
    if ! curl -fsSL --retry 3 --connect-timeout 20 --max-time 300 \
      https://ollama.com/install.sh -o "$installer"; then
      rm -f "$installer"
      warn "unduhan installer Ollama gagal."
      return 1
    fi
    if ! bash "$installer" >"$LOG_DIR/ollama-install.log" 2>&1; then
      rm -f "$installer"
      warn "instalasi Ollama gagal (lihat $LOG_DIR/ollama-install.log)."
      return 1
    fi
    rm -f "$installer"
  fi
  export OLLAMA_MODELS="$GPU_DIR/ollama"
  export OLLAMA_HOST="127.0.0.1:${OLLAMA_PORT}"
  mkdir -p "$OLLAMA_MODELS"
  if ! port_terbuka "$OLLAMA_PORT"; then
    # NUM_PARALLEL: beberapa permintaan (mis. judul percakapan) sekaligus pada
    # satu GPU. MAX_LOADED_MODELS=1 supaya GPU 1 hanya memuat satu model
    # sekaligus. KEEP_ALIVE menahan model di VRAM agar panggilan berikutnya
    # tidak memuat ulang dari disk; 10m cukup untuk jeda antar-percakapan.
    start_bg ollama "$LOG_DIR/ollama.log" env OLLAMA_MODELS="$OLLAMA_MODELS" \
      OLLAMA_HOST="$OLLAMA_HOST" \
      OLLAMA_NUM_PARALLEL="${GPU_OLLAMA_NUM_PARALLEL:-4}" \
      OLLAMA_MAX_LOADED_MODELS="${GPU_OLLAMA_MAX_LOADED_MODELS:-1}" \
      OLLAMA_KEEP_ALIVE="${GPU_OLLAMA_KEEP_ALIVE:-10m}" \
      CUDA_VISIBLE_DEVICES="$(gpu_untuk ollama)" ollama serve
  fi
  wait_http "http://127.0.0.1:${OLLAMA_PORT}/api/tags" 60 2 || { warn "Ollama tidak menjawab."; return 1; }
  if ! ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$OLLAMA_MODEL"; then
    info "mengunduh model Ollama ${OLLAMA_MODEL} (bisa beberapa menit)..."
    OLLAMA_HOST="$OLLAMA_HOST" ollama pull "$OLLAMA_MODEL" >>"$LOG_DIR/ollama.log" 2>&1 \
      || { warn "pull ${OLLAMA_MODEL} gagal."; return 1; }
  fi
  # Muat bobot ke VRAM sekarang, bukan pada permintaan pertama aplikasi
  # (pemuatan dingin dari disk bisa >2 menit dan melewati batas waktu judul).
  curl -fsS --max-time 600 "http://127.0.0.1:${OLLAMA_PORT}/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"${OLLAMA_MODEL}\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":1}" \
    >>"$LOG_DIR/ollama.log" 2>&1 || warn "pemanasan model Ollama gagal."
  return 0
}

pasang_comfyui() {
  local dir="$GPU_DIR/comfyui" ckpt="$GPU_DIR/comfyui/models/checkpoints/$IMAGE_MODEL"
  if [[ ! -d "$dir/.git" ]]; then
    info "meng-clone ComfyUI..."
    rm -rf "$dir"
    git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git "$dir" \
      >"$LOG_DIR/comfyui-clone.log" 2>&1 || { warn "clone ComfyUI gagal."; return 1; }
  fi
  python_venv "$dir/.venv" || { warn "tidak bisa membuat venv ComfyUI."; return 1; }
  if [[ ! -f "$dir/.openmaic-deps" ]]; then
    info "memasang dependensi ComfyUI (torch dari sistem dipakai ulang)..."
    pip_install "$dir/.venv" -r "$dir/requirements.txt" >>"$LOG_DIR/comfyui-pip.log" 2>&1 \
      || { warn "pip ComfyUI gagal (lihat $LOG_DIR/comfyui-pip.log)."; return 1; }
    touch "$dir/.openmaic-deps"
  fi
  if [[ "$IMAGE_MODEL" != "none" && ! -f "$ckpt" ]]; then
    info "mengunduh checkpoint ${IMAGE_MODEL} (~6.9 GB)..."
    mkdir -p "$(dirname "$ckpt")"
    curl -fL --retry 3 --connect-timeout 20 \
      "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/${IMAGE_MODEL}" \
      -o "$ckpt.part" >>"$LOG_DIR/comfyui-model.log" 2>&1 \
      && mv "$ckpt.part" "$ckpt" \
      || { rm -f "$ckpt.part"; warn "unduhan checkpoint gagal."; return 1; }
  fi
  if ! port_terbuka "$COMFYUI_PORT"; then
    start_bg comfyui "$LOG_DIR/comfyui.log" env CUDA_VISIBLE_DEVICES="$(gpu_untuk comfyui)" \
      "$dir/.venv/bin/python" "$dir/main.py" --listen 127.0.0.1 --port "$COMFYUI_PORT" \
      --disable-auto-launch
  fi
  wait_http "http://127.0.0.1:${COMFYUI_PORT}/system_stats" 90 2 \
    || { warn "ComfyUI tidak menjawab."; return 1; }
  return 0
}

pasang_funasr() {
  local venv="$GPU_DIR/venv-funasr" server="$REPO_ROOT/scripts/gpu_servers/funasr_openai_server.py"
  [[ -f "$server" ]] || { warn "server FunASR tidak ditemukan: $server"; return 1; }
  python_venv "$venv" || { warn "tidak bisa membuat venv FunASR."; return 1; }
  if [[ ! -f "$venv/.openmaic-deps" ]]; then
    info "memasang FunASR (CUDA)..."
    pip_install "$venv" "funasr==1.4.0" fastapi uvicorn python-multipart soundfile \
      >>"$LOG_DIR/funasr-pip.log" 2>&1 \
      || { warn "pip FunASR gagal (lihat $LOG_DIR/funasr-pip.log)."; return 1; }
    touch "$venv/.openmaic-deps"
  fi
  if ! port_terbuka "$FUNASR_PORT"; then
    start_bg funasr "$LOG_DIR/funasr.log" env CUDA_VISIBLE_DEVICES="$(gpu_untuk funasr)" \
      FUNASR_DEVICE="cuda:0" "$venv/bin/python" "$server" --host 127.0.0.1 --port "$FUNASR_PORT"
  fi
  # Muat model pertama kali butuh unduhan ~1 GB; beri waktu lebih.
  wait_http "http://127.0.0.1:${FUNASR_PORT}/health" 300 2 \
    || { warn "FunASR tidak menjawab (lihat $LOG_DIR/funasr.log)."; return 1; }
  return 0
}

pasang_voxcpm() {
  local venv="$GPU_DIR/venv-voxcpm" server="$REPO_ROOT/scripts/gpu_servers/voxcpm_openai_server.py"
  [[ -f "$server" ]] || { warn "server VoxCPM tidak ditemukan: $server"; return 1; }
  python_venv "$venv" || { warn "tidak bisa membuat venv VoxCPM."; return 1; }
  if [[ ! -f "$venv/.openmaic-deps" ]]; then
    info "memasang voxcpm (model dimuat saat permintaan pertama)..."
    pip_install "$venv" voxcpm >>"$LOG_DIR/voxcpm-pip.log" 2>&1 \
      || { warn "pip voxcpm gagal (lihat $LOG_DIR/voxcpm-pip.log)."; return 1; }
    touch "$venv/.openmaic-deps"
  fi
  if ! port_terbuka "$VOXCPM_PORT"; then
    start_bg voxcpm "$LOG_DIR/voxcpm.log" env CUDA_VISIBLE_DEVICES="$(gpu_untuk voxcpm)" \
      VOXCPM_DEVICE="cuda:0" "$venv/bin/python" "$server" --host 127.0.0.1 --port "$VOXCPM_PORT"
  fi
  wait_http "http://127.0.0.1:${VOXCPM_PORT}/health" 90 2 \
    || { warn "VoxCPM tidak menjawab (lihat $LOG_DIR/voxcpm.log)."; return 1; }
  if [[ "$SMOKE" == "1" ]]; then
    info "uji sintesis VoxCPM (unduhan model bisa memakan waktu)..."
    if curl -fsS --max-time 900 -o "$LOG_DIR/voxcpm-smoke.wav" \
      -F "text=Halo, ini uji suara kelas." -F "cfg_value=2.0" -F "inference_timesteps=10" \
      "http://127.0.0.1:${VOXCPM_PORT}/tts/upload"; then
      info "VoxCPM menghasilkan $(stat -c %s "$LOG_DIR/voxcpm-smoke.wav" 2>/dev/null || echo 0) byte WAV."
    else
      warn "uji sintesis VoxCPM gagal (lihat $LOG_DIR/voxcpm.log)."
      return 1
    fi
  fi
  return 0
}

# ---------------------------------------------------------------- status
if [[ "$ACTION" == "status" ]]; then
  for nama in "${LAYANAN_URUT[@]}"; do
    if status_layanan "$nama"; then printf '%-8s UP\n' "$nama"; else printf '%-8s DOWN\n' "$nama"; fi
  done
  exit 0
fi

# ---------------------------------------------------------------- main
gpu_terdeteksi || fail "tidak ada NVIDIA GPU (nvidia-smi kosong). Jalankan tanpa --with-gpu/--colab GPU."
mkdir -p "$GPU_DIR" "$LOG_DIR" "$PID_DIR" "$HF_HOME" "$MODELSCOPE_CACHE"
chown "$OWNSERVE" "$GPU_DIR" "$LOG_DIR" "$PID_DIR" 2>/dev/null || true
if [[ "$(id -u)" -eq 0 && "$OWNSERVE" != "root" ]]; then
  chown -R "$OWNSERVE" "$HF_HOME" "$MODELSCOPE_CACHE" 2>/dev/null || true
fi

info "GPU terdeteksi: $(jumlah_gpu) perangkat; direktori model $GPU_DIR"

declare -A STATUS=()
# Status run sebelumnya dipertahankan untuk layanan yang tidak dipilih kali
# ini (`--only`/`--skip`), supaya file status tidak menurunkan layanan yang
# masih hidup.
if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; . "$STATE_FILE"; set +a
  for _nama in "${LAYANAN_URUT[@]}"; do
    _kunci="GPU_$(printf '%s' "$_nama" | tr '[:lower:]' '[:upper:]')_STATUS"
    if [[ "${!_kunci:-down}" == "up" ]]; then STATUS[$_nama]="up"; fi
  done
  unset _nama _kunci
fi

for nama in "${LAYANAN_URUT[@]}"; do
  if ! ingin_layanan "$nama"; then continue; fi
  if [[ "$START" -ne 1 ]]; then
    info "melewati start $nama (--no-start)."
    continue
  fi
  info "menyiapkan $nama..."
  if "pasang_${nama}"; then
    STATUS[$nama]="up"
    info "$nama siap."
  else
    STATUS[$nama]="down"
    warn "$nama tidak siap; fitur terkait tidak akan diaktifkan."
  fi
done

{
  echo "# Dibuat scripts/gpu-services.sh $(date -Is)"
  echo "GPU_MODELS_DIR=\"$GPU_DIR\""
  [[ "${STATUS[ollama]:-down}" == "up" ]] && {
    echo "GPU_OLLAMA_URL=\"http://127.0.0.1:${OLLAMA_PORT}/v1\""
    echo "GPU_OLLAMA_MODELS=\"$OLLAMA_MODEL\""
    echo "GPU_OLLAMA_STATUS=\"up\""
  } || echo "GPU_OLLAMA_STATUS=\"down\""
  [[ "${STATUS[comfyui]:-down}" == "up" ]] && {
    echo "GPU_COMFYUI_URL=\"http://127.0.0.1:${COMFYUI_PORT}\""
    echo "GPU_COMFYUI_STATUS=\"up\""
  } || echo "GPU_COMFYUI_STATUS=\"down\""
  [[ "${STATUS[funasr]:-down}" == "up" ]] && {
    echo "GPU_FUNASR_URL=\"http://127.0.0.1:${FUNASR_PORT}/v1\""
    echo "GPU_FUNASR_STATUS=\"up\""
  } || echo "GPU_FUNASR_STATUS=\"down\""
  [[ "${STATUS[voxcpm]:-down}" == "up" ]] && {
    echo "GPU_VOXCPM_URL=\"http://127.0.0.1:${VOXCPM_PORT}\""
    echo "GPU_VOXCPM_STATUS=\"up\""
  } || echo "GPU_VOXCPM_STATUS=\"down\""
} >"$STATE_FILE"
chown "$OWNSERVE" "$STATE_FILE" 2>/dev/null || true
info "status ditulis ke $STATE_FILE"
cat "$STATE_FILE"

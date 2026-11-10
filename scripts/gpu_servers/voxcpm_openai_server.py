#!/usr/bin/env python3
"""VoxCPM2 FastAPI server for OpenMAIC's `python-api` TTS backend.

OpenMAIC's VoxCPM adapter selects the backend with
`providers.<id>.options.backend` in openmaic.yml. The `python-api` backend
posts multipart form data to `/tts/upload` and expects raw audio back, so this
server wraps the official `voxcpm` package with exactly that contract:

    POST /tts/upload   text, cfg_value, inference_timesteps, normalize,
                       denoise, reference_audio?, prompt_audio?, prompt_text?
    GET  /health       liveness + model/device info

It is the GPU path: VoxCPM2 runs on CUDA, generates 48 kHz WAV, and needs no
API key. Voice registration (`/v1/audio/voices`) is only offered by the
vLLM-Omni backend; with this backend OpenMAIC sends the reference clip inline
on every request instead.

Start (the installer does this for you):

    voxcpm-server --device cuda:0 --port 8001

Environment:
    VOXCPM_MODEL_ID    HF repo id or local path (default: openbmb/VoxCPM2)
    VOXCPM_DEVICE      torch device (default: cuda:0, falls back to cpu)
    VOXCPM_OPTIMIZE    "1" to torch.compile the model (default: 0)
    VOXCPM_DENOISER    "1" to load the ZipEnhancer denoiser (default: 0)
    HF_HOME / VOXCPM_CACHE_DIR   model cache location
"""

from __future__ import annotations

import argparse
import io
import os
import tempfile
import threading
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response

MODEL_ID = os.environ.get("VOXCPM_MODEL_ID", "openbmb/VoxCPM2")
DEFAULT_DEVICE = os.environ.get("VOXCPM_DEVICE", "cuda:0")
CACHE_DIR = os.environ.get("VOXCPM_CACHE_DIR") or None

app = FastAPI(title="VoxCPM2 TTS (python-api backend)", version="1.0.0")

_model = None
_model_error: Optional[str] = None
_lock = threading.Lock()


def resolve_device(requested: str) -> str:
    if not requested.startswith("cuda"):
        return requested
    try:
        import torch

        if torch.cuda.is_available():
            return requested
    except Exception:
        pass
    return "cpu"


def get_model():
    """Load VoxCPM2 once; surface load failures as 503 instead of a traceback."""
    global _model, _model_error
    if _model is not None:
        return _model
    with _lock:
        if _model is not None:
            return _model
        try:
            from voxcpm import VoxCPM

            _model = VoxCPM.from_pretrained(
                MODEL_ID,
                load_denoiser=os.environ.get("VOXCPM_DENOISER", "0") == "1",
                cache_dir=CACHE_DIR,
                optimize=os.environ.get("VOXCPM_OPTIMIZE", "0") == "1",
                device=resolve_device(DEFAULT_DEVICE),
            )
            _model_error = None
        except Exception as exc:  # pragma: no cover - depends on host/model download
            _model_error = f"{type(exc).__name__}: {exc}"
            raise
    return _model


def write_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    sf.write(buffer, np.asarray(audio, dtype=np.float32), int(sample_rate), format="WAV")
    return buffer.getvalue()


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok" if _model is not None or _model_error is None else "error",
        "backend": "python-api",
        "model": MODEL_ID,
        "device": resolve_device(DEFAULT_DEVICE),
        "loaded": _model is not None,
        "error": _model_error,
    }


@app.post("/tts/upload")
async def tts_upload(
    text: str = Form(...),
    cfg_value: float = Form(2.0),
    inference_timesteps: int = Form(10),
    normalize: bool = Form(False),
    denoise: bool = Form(False),
    reference_audio: Optional[UploadFile] = File(None),
    prompt_audio: Optional[UploadFile] = File(None),
    prompt_text: Optional[str] = Form(None),
) -> Response:
    if not text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")

    try:
        model = get_model()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"VoxCPM model failed to load: {exc}") from exc

    temp_paths: list[str] = []
    try:
        reference_path = None
        if reference_audio is not None:
            reference_path = await _save_upload(reference_audio, temp_paths)
        prompt_path = None
        if prompt_audio is not None:
            prompt_path = await _save_upload(prompt_audio, temp_paths)

        kwargs: dict[str, object] = {
            "text": text,
            "cfg_value": float(cfg_value),
            "inference_timesteps": int(inference_timesteps),
            "normalize": bool(normalize),
            "denoise": bool(denoise),
        }
        if reference_path:
            kwargs["reference_wav_path"] = reference_path
        if prompt_path:
            kwargs["prompt_wav_path"] = prompt_path
            if prompt_text and prompt_text.strip():
                kwargs["prompt_text"] = prompt_text.strip()

        with _lock:
            audio = model.generate(**kwargs)
    finally:
        for path in temp_paths:
            try:
                os.unlink(path)
            except OSError:
                pass

    if audio is None or len(audio) == 0:
        raise HTTPException(status_code=500, detail="VoxCPM returned empty audio")
    sample_rate = int(getattr(model.tts_model, "sample_rate", 48000))
    return Response(content=write_wav_bytes(audio, sample_rate), media_type="audio/wav")


async def _save_upload(upload: UploadFile, temp_paths: list[str]) -> str:
    raw = await upload.read()
    if not raw:
        raise HTTPException(status_code=400, detail="reference audio is empty")
    suffix = Path(upload.filename or "reference.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        handle.write(raw)
        temp_paths.append(handle.name)
        return handle.name


def main() -> None:
    global DEFAULT_DEVICE
    parser = argparse.ArgumentParser(description="VoxCPM2 TTS server (python-api backend)")
    parser.add_argument("--device", default=DEFAULT_DEVICE)
    parser.add_argument("--host", default=os.environ.get("VOXCPM_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("VOXCPM_PORT", "8001")))
    parser.add_argument(
        "--preload",
        action="store_true",
        help="download and load the model before serving (otherwise on first request)",
    )
    args = parser.parse_args()

    DEFAULT_DEVICE = args.device
    if args.preload:
        get_model()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""OpenAI-compatible FunASR transcription server.

Serves the small subset of the OpenAI audio API that OpenMAIC's FunASR
adapter uses, so `slots.asr` can point at a self-hosted GPU box:

    POST /v1/audio/transcriptions   multipart: file (WAV), model, language?
    GET  /health                    liveness + which models are loaded

The app posts `model` as one of its registry ids (`sensevoice`,
`paraformer`, `fun-asr-nano`); each id is mapped to a ModelScope repo id
below. Only WAV input is accepted, matching the adapter's contract.

Start (the installer does this for you):

    funasr-server --device cuda:0 --port 8000
    # or: uvicorn scripts.gpu_servers.funasr_openai_server:app --port 8000

Environment:
    FUNASR_DEVICE       torch device string (default: cuda:0, falls back to cpu)
    FUNASR_MODEL_DIR    ModelScope cache dir (default: ~/.cache/modelscope)
    FUNASR_DEFAULT_MODEL  model id to preload (default: sensevoice)
"""

from __future__ import annotations

import argparse
import os
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from funasr import AutoModel

# Registry ids from lib/audio/constants.ts -> ModelScope repos.
MODEL_REPOS: dict[str, str] = {
    "sensevoice": "iic/SenseVoiceSmall",
    "paraformer": "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "fun-asr-nano": os.environ.get("FUNASR_NANO_REPO", "FunAudioLLM/Fun-ASR-Nano-2512"),
}

# SenseVoice emits rich tags (<|zh|><|NEUTRAL|><|Speech|><|woitn|>) unless
# post-processed; the adapter expects plain text.
POSTPROCESS = {"sensevoice"}

DEFAULT_DEVICE = os.environ.get("FUNASR_DEVICE", "cuda:0")

app = FastAPI(title="FunASR OpenAI-compatible ASR", version="1.0.0")

_models: dict[str, AutoModel] = {}
_lock = threading.Lock()


def resolve_device(requested: str) -> str:
    """Fall back to CPU when CUDA is unavailable instead of failing at import."""
    if not requested.startswith("cuda"):
        return requested
    try:
        import torch

        if torch.cuda.is_available():
            return requested
    except Exception:  # pragma: no cover - torch is a hard dependency in practice
        pass
    return "cpu"


def load_model(model_id: str) -> AutoModel:
    key = model_id if model_id in MODEL_REPOS else "sensevoice"
    with _lock:
        if key not in _models:
            repo = MODEL_REPOS[key]
            _models[key] = AutoModel(
                model=repo,
                device=resolve_device(DEFAULT_DEVICE),
                disable_update=True,
            )
        return _models[key]


def plain_text(model_key: str, raw: str) -> str:
    if model_key not in POSTPROCESS:
        return raw
    try:
        from funasr.utils.postprocess_utils import rich_transcription_postprocess

        return rich_transcription_postprocess(raw)
    except Exception:
        return raw


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "device": resolve_device(DEFAULT_DEVICE), "loaded": sorted(_models)}


@app.get("/v1/models")
def models() -> dict[str, object]:
    return {
        "object": "list",
        "data": [{"id": model_id, "object": "model"} for model_id in MODEL_REPOS],
    }


@app.post("/v1/audio/transcriptions")
async def transcriptions(
    file: UploadFile = File(...),
    model: str = Form("sensevoice"),
    language: str | None = Form(None),
    response_format: str = Form("json"),
) -> JSONResponse:
    raw = await file.read()
    if len(raw) < 44 or raw[:4] != b"RIFF":
        raise HTTPException(status_code=400, detail="audio is empty or not a WAV file")

    model_key = model if model in MODEL_REPOS else "sensevoice"
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        handle.write(raw)
        path = handle.name
    try:
        engine = load_model(model_key)
        kwargs: dict[str, object] = {"input": path, "batch_size_s": 60}
        if model_key in POSTPROCESS:
            kwargs["language"] = "auto" if not language or language == "auto" else language
            kwargs["use_itn"] = True
        result = engine.generate(**kwargs)
        text = ""
        if isinstance(result, list) and result:
            text = str(result[0].get("text", ""))
        text = plain_text(model_key, text)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

    if response_format == "text":
        return JSONResponse(content=text)
    return JSONResponse(content={"text": text, "model": model_key})


def main() -> None:
    global DEFAULT_DEVICE
    parser = argparse.ArgumentParser(description="FunASR OpenAI-compatible ASR server")
    parser.add_argument("--device", default=DEFAULT_DEVICE, help="torch device, e.g. cuda:0")
    parser.add_argument("--host", default=os.environ.get("FUNASR_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("FUNASR_PORT", "8000")))
    parser.add_argument(
        "--preload",
        default=os.environ.get("FUNASR_DEFAULT_MODEL", "sensevoice"),
        help="model id to load before serving (empty string skips preloading)",
    )
    args = parser.parse_args()

    DEFAULT_DEVICE = args.device
    if args.preload:
        load_model(args.preload)

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# Copyright 2026
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""One-turn Google Antigravity SDK bridge for the OpenMAIC Pro Workbench.

OpenMAIC owns the agent loop (tools, allowlist, timeouts, quota, transcript,
SSE). This bridge only asks the local Antigravity agent for the next assistant
message, constrained by a response schema to the same contract the Codex
transport uses:

    {"text": "...", "toolCalls": [{"name": "...", "arguments": "..."}]}

The SDK is a full Python agent, so its own built-in tools are switched off
(only ``finish`` stays exposed to return structured output), no workspace is
shared, and every turn gets a throwaway temp directory. The SDK therefore
cannot read or write the host: it can only produce the structured reply.

Protocol: one JSON request on stdin, one JSON response on stdout. Diagnostics
go to stderr so a stray log line can never corrupt the response.

Request fields:
    model               Antigravity model id (e.g. gemini-3.8-flash)
    apiKey              Gemini API key (optional; env is used when absent)
    vertex              true for Gemini Enterprise / Vertex AI endpoints
    project, location   Vertex project/location (Standard mode)
    systemInstructions  System prompt for the turn
    prompt              Rendered conversation + tool catalogue
    responseSchema      JSON schema the finish tool must satisfy
    thinkingLevel       minimal | low | medium | high | extra_high
    maxOutputTokens     Optional output cap (None keeps the model default)
    timeoutMs           Hard ceiling for one turn

Response fields:
    text         Plain assistant text (may be empty for a tool-only turn)
    structured   Parsed structured output, or null
    usage        Token counts (camelCase, null when unavailable)
    stopReason   SDK stop reason, or null

An error is reported as ``{"error": "...", "kind": "..."}`` with exit code 1.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import tempfile
from typing import Any

# The SDK imports are deliberately inside main() so a missing package can be
# reported as a clean JSON error instead of an import-time traceback on stdout.
MAX_REQUEST_BYTES = 64 * 1024 * 1024
DEFAULT_TIMEOUT_MS = 900_000  # 15 minutes, the keyed/Codex transport budget


def _configure_logging() -> None:
    """Send every library log to stderr; stdout is the protocol channel."""
    logging.basicConfig(
        level=logging.WARNING,
        stream=sys.stderr,
        format="[antigravity] %(levelname)s %(name)s: %(message)s",
    )
    # The harness/absl stack is chatty at INFO; a bridge turn does not need it.
    logging.getLogger("absl").setLevel(logging.ERROR)
    logging.getLogger("google").setLevel(logging.WARNING)


def _read_request() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        raise ValueError("Antigravity request exceeded the 64 MiB bridge limit.")
    if not raw.strip():
        raise ValueError("Antigravity bridge received an empty request.")
    parsed = json.loads(raw.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("Antigravity bridge request must be a JSON object.")
    return parsed


def _optional_str(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _endpoint_fields(
    request: dict[str, Any],
) -> tuple[str | None, bool, str | None, str | None]:
    """Normalize auth fields shared by the model endpoint and the config.

    Vertex AI has two mutually exclusive auth modes: Express Mode (an API key)
    and Standard Mode (project + location with Application Default
    Credentials). An API key wins, because the caller explicitly supplied one;
    project/location are dropped so the SDK validator does not reject the pair.
    """
    api_key = _optional_str(request.get("apiKey"))
    vertex = bool(request.get("vertex"))
    project = _optional_str(request.get("project"))
    location = _optional_str(request.get("location"))
    if vertex and api_key:
        project = None
        location = None
    return api_key, vertex, project, location


def _build_endpoint(request: dict[str, Any]) -> Any:
    from google.antigravity import (
        GeminiAPIEndpoint,
        GeminiModelOptions,
        ThinkingLevel,
        VertexEndpoint,
    )

    level_raw = _optional_str(request.get("thinkingLevel"))
    level = None
    if level_raw:
        try:
            level = ThinkingLevel(level_raw)
        except ValueError as exc:
            allowed = ", ".join(item.value for item in ThinkingLevel)
            raise ValueError(
                f"Unsupported Antigravity thinking level {level_raw!r}; expected one of: {allowed}."
            ) from exc

    max_output = request.get("maxOutputTokens")
    if max_output is not None and (
        not isinstance(max_output, int) or isinstance(max_output, bool) or max_output <= 0
    ):
        raise ValueError("maxOutputTokens must be a positive integer when set.")

    options = GeminiModelOptions(
        thinking_level=level,
        max_output_tokens=max_output,
    )
    api_key, vertex, project, location = _endpoint_fields(request)
    if vertex:
        return VertexEndpoint(
            project=project,
            location=location,
            api_key=api_key,
            options=options,
        )
    return GeminiAPIEndpoint(api_key=api_key, options=options)


async def _run_turn(request: dict[str, Any]) -> dict[str, Any]:
    from google.antigravity import (
        Agent,
        BuiltinTools,
        CapabilitiesConfig,
        LocalAgentConfig,
        ModelTarget,
        ModelType,
    )
    from google.antigravity.hooks import policy

    model = _optional_str(request.get("model"))
    if not model:
        raise ValueError("model is required.")
    system_instructions = request.get("systemInstructions")
    if not isinstance(system_instructions, str) or not system_instructions.strip():
        raise ValueError("systemInstructions is required.")
    prompt = request.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("prompt is required.")
    response_schema = request.get("responseSchema")
    if not isinstance(response_schema, dict):
        raise ValueError("responseSchema must be a JSON object.")

    endpoint = _build_endpoint(request)
    target = ModelTarget(
        name=model,
        types=[ModelType.TEXT],
        endpoint=endpoint,
    )
    api_key, vertex, project, location = _endpoint_fields(request)

    with tempfile.TemporaryDirectory(prefix="openmaic-antigravity-") as workdir:
        config = LocalAgentConfig(
            system_instructions=system_instructions,
            models=[target],
            # Shorthand auth also covers the image model the SDK derives from
            # the default model list; every configured model is validated.
            api_key=api_key,
            vertex=vertex,
            project=project,
            location=location,
            # Only `finish` is exposed: it is the structured-output channel.
            # No file, shell, web, subagent or MCP tool can run in this turn.
            capabilities=CapabilitiesConfig(
                enabled_tools=[BuiltinTools.FINISH],
                enable_subagents=False,
            ),
            # Belt and braces: even if the SDK ever changes its default tool
            # set, deny everything and re-approve only the finish tool. This
            # also means no ASK_USER prompt can ever wait on stdin.
            policies=[policy.deny_all(), policy.allow(BuiltinTools.FINISH.value)],
            response_schema=response_schema,
            workspaces=[workdir],
            save_dir=workdir,
            app_data_dir=workdir,
        )

        async with Agent(config) as agent:
            response = await agent.chat(prompt)

            structured: Any = None
            try:
                structured = await response.structured_output()
            except Exception:  # noqa: BLE001 - a plain text turn is still usable
                logging.getLogger(__name__).debug(
                    "Antigravity structured_output() failed; falling back to text.",
                    exc_info=True,
                )
            text = await response.text()

            usage = response.usage_metadata
            stop_reason = response.stop_reason
            stop_value = getattr(stop_reason, "value", None) or (
                str(stop_reason) if stop_reason is not None else None
            )
            return {
                "text": text or "",
                "structured": structured if isinstance(structured, (dict, list)) else None,
                "usage": (
                    {
                        "promptTokenCount": usage.prompt_token_count,
                        "cachedContentTokenCount": usage.cached_content_token_count,
                        "candidatesTokenCount": usage.candidates_token_count,
                        "thoughtsTokenCount": usage.thoughts_token_count,
                        "totalTokenCount": usage.total_token_count,
                    }
                    if usage is not None
                    else None
                ),
                "stopReason": stop_value,
            }


async def _main_async(request: dict[str, Any]) -> dict[str, Any]:
    raw_timeout = request.get("timeoutMs")
    timeout_ms = (
        raw_timeout
        if isinstance(raw_timeout, int) and not isinstance(raw_timeout, bool) and raw_timeout > 0
        else DEFAULT_TIMEOUT_MS
    )
    return await asyncio.wait_for(_run_turn(request), timeout=timeout_ms / 1000.0)


def main() -> int:
    _configure_logging()
    # The SDK needs a writable temp root; respect the host's TMPDIR when set.
    os.environ.setdefault("PYTHONUNBUFFERED", "1")
    try:
        request = _read_request()
        result = asyncio.run(_main_async(request))
    except Exception as exc:  # noqa: BLE001 - the protocol reports any failure
        logging.getLogger(__name__).debug("Antigravity bridge failure", exc_info=True)
        payload = {"error": str(exc) or exc.__class__.__name__, "kind": exc.__class__.__name__}
        sys.stdout.write(json.dumps(payload, ensure_ascii=False))
        sys.stdout.flush()
        return 1

    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

/**
 * Google Antigravity SDK bridge for the OpenMAIC Pro Workbench agent driver.
 *
 * The SDK (https://antigravity.google/product/antigravity-sdk/) is a Python
 * agent, not an HTTP model endpoint. OpenMAIC keeps its loop — tools,
 * allowlist, timeouts, quota, transcript and SSE — and this module only asks a
 * local Python process for one structured turn:
 *
 *   { "text": "...", "toolCalls": [{ "name": "...", "arguments": "..." }] }
 *
 * `lib/ai/antigravity_bridge.py` owns the SDK call. It disables every built-in
 * tool except `finish`, uses a throwaway temp directory, and returns the
 * structured payload as JSON. The bridge is launched per turn, so a crashed or
 * hung SDK process cannot poison the runner. Install it with:
 *
 *   pip install google-antigravity
 *
 * Server-side only. The process spawn is lazy so client bundles that reach the
 * provider registry never pull `node:child_process` in.
 */

import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

/** Route `api` value that selects the Antigravity SDK transport. */
export const ANTIGRAVITY_SDK_DRIVER_API = 'antigravity-sdk' as const;

/** Provider id executed through the local Antigravity SDK (no HTTP endpoint). */
export const ANTIGRAVITY_SDK_PROVIDER = 'antigravity' as const;

/** Model a bare provider reference uses; the SDK's own default. */
export const ANTIGRAVITY_SDK_DEFAULT_MODEL = 'gemini-3.8-flash';

/** Per-turn ceiling: the same budget as the keyed HTTP and Codex transports. */
export const ANTIGRAVITY_SDK_DEFAULT_TIMEOUT_MS = 900_000;

/** The bridge is small; this only protects the parent from a runaway stream. */
const MAX_BRIDGE_OUTPUT_BYTES = 32 * 1024 * 1024;

/** How long the readiness probe may take (`python -c "import …"`). */
const PROBE_TIMEOUT_MS = 20_000;

export interface AntigravitySdkSettings {
  /** Antigravity model id (`gemini-3.8-flash`, `gemini-4-argon`, …). */
  model?: string;
  /** Gemini API key; when absent the SDK reads GEMINI_API_KEY from the env. */
  apiKey?: string;
  /** True for Gemini Enterprise / Vertex AI endpoints. */
  vertex?: boolean;
  project?: string;
  location?: string;
  /** Python interpreter. Defaults to `python3`, or ANTIGRAVITY_PYTHON. */
  pythonPath?: string;
  /** Bridge script. Defaults to the file in this repository. */
  bridgePath?: string;
  /** Turn ceiling in milliseconds. */
  timeoutMs?: number;
  /** Optional output cap; omitted means the model default. */
  maxOutputTokens?: number;
}

export interface AntigravityTurnRequest {
  prompt: string;
  systemInstructions: string;
  responseSchema: Record<string, unknown>;
  model: string;
  /** SDK thinking level: minimal | low | medium | high | extra_high. */
  thinkingLevel?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AntigravityUsage {
  promptTokenCount?: number | null;
  cachedContentTokenCount?: number | null;
  candidatesTokenCount?: number | null;
  thoughtsTokenCount?: number | null;
  totalTokenCount?: number | null;
}

export interface AntigravityTurnResult {
  text: string;
  structured: unknown;
  usage: AntigravityUsage | null;
  stopReason: string | null;
}

const execFileAsync = promisify(execFile);

function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function readBooleanEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function readNumberEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Directory that contains `package.json`, walking up from the server's cwd. */
function repositoryRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(/*turbopackIgnore: true*/ path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function resolveFromRoot(value: string): string {
  return path.isAbsolute(value)
    ? value
    : path.join(/*turbopackIgnore: true*/ repositoryRoot(), value);
}

/** Absolute path of the bridge, or an empty string when it was not shipped. */
export function resolveAntigravityBridgePath(): string {
  const configured = readEnv('ANTIGRAVITY_BRIDGE', 'OPENMAIC_ANTIGRAVITY_BRIDGE');
  if (configured) return resolveFromRoot(configured);

  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(
      /*turbopackIgnore: true*/ dir,
      'lib',
      'ai',
      'antigravity_bridge.py',
    );
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

/** Python interpreter, resolving a relative ANTIGRAVITY_PYTHON against the repo. */
export function resolveAntigravityPython(): string {
  const configured = readEnv('ANTIGRAVITY_PYTHON', 'OPENMAIC_ANTIGRAVITY_PYTHON');
  return configured ? resolveFromRoot(configured) : 'python3';
}

/**
 * Deployment settings for the transport, from the environment.
 *
 * - `GEMINI_API_KEY` / `GOOGLE_API_KEY` — the SDK's Gemini key.
 * - `ANTIGRAVITY_MODEL` / `OPENMAIC_ANTIGRAVITY_MODEL` — default model id.
 * - `ANTIGRAVITY_PYTHON` — interpreter (a project-local venv is fine, relative
 *   paths resolve from the repository root).
 * - `ANTIGRAVITY_BRIDGE` — explicit bridge path.
 * - `OPENMAIC_ANTIGRAVITY_TIMEOUT_MS` — per-turn ceiling.
 * - `OPENMAIC_ANTIGRAVITY_MAX_OUTPUT_TOKENS` — optional output cap.
 * - `GOOGLE_GENAI_USE_VERTEXAI` / `GOOGLE_GENAI_USE_ENTERPRISE` — Vertex mode,
 *   with `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`. `*_API_KEY` in
 *   that mode means Express Mode.
 */
export function antigravitySdkSettingsFromEnv(
  overrides: AntigravitySdkSettings = {},
): AntigravitySdkSettings {
  const vertex =
    overrides.vertex ??
    (readBooleanEnv('GOOGLE_GENAI_USE_VERTEXAI') || readBooleanEnv('GOOGLE_GENAI_USE_ENTERPRISE'));

  const settings: AntigravitySdkSettings = {
    model: overrides.model ?? readEnv('ANTIGRAVITY_MODEL', 'OPENMAIC_ANTIGRAVITY_MODEL'),
    apiKey: overrides.apiKey ?? readEnv('GEMINI_API_KEY', 'GOOGLE_API_KEY'),
    vertex,
    project: overrides.project ?? readEnv('GOOGLE_CLOUD_PROJECT'),
    location: overrides.location ?? readEnv('GOOGLE_CLOUD_LOCATION'),
    pythonPath: overrides.pythonPath ?? resolveAntigravityPython(),
    bridgePath: overrides.bridgePath ?? resolveAntigravityBridgePath(),
    timeoutMs: overrides.timeoutMs ?? readNumberEnv('OPENMAIC_ANTIGRAVITY_TIMEOUT_MS'),
    maxOutputTokens:
      overrides.maxOutputTokens ?? readNumberEnv('OPENMAIC_ANTIGRAVITY_MAX_OUTPUT_TOKENS'),
  };
  return settings;
}

/** True when a key (or Vertex ADC with a project/location) is configured. */
export function isAntigravityAuthConfigured(
  settings: AntigravitySdkSettings = antigravitySdkSettingsFromEnv(),
): boolean {
  if (settings.apiKey) return true;
  // Vertex Standard mode authenticates through Application Default Credentials.
  return settings.vertex === true && !!settings.project && !!settings.location;
}

export interface AntigravityPythonStatus {
  /** The bridge file exists in this deployment. */
  bridge: boolean;
  /** `import google.antigravity` succeeded. */
  installed: boolean;
  /** A key or Vertex credentials are configured. */
  authenticated: boolean;
  /** Human-readable status for the workbench dialog and logs. */
  message: string;
}

/**
 * Probe the local Python environment and credentials without starting a turn.
 * A missing interpreter/package is reported, never thrown.
 */
export async function antigravityPythonStatus(
  settings: AntigravitySdkSettings = antigravitySdkSettingsFromEnv(),
): Promise<AntigravityPythonStatus> {
  const bridge =
    !!settings.bridgePath && fs.existsSync(/*turbopackIgnore: true*/ settings.bridgePath);
  if (!bridge) {
    return {
      bridge: false,
      installed: false,
      authenticated: isAntigravityAuthConfigured(settings),
      message:
        'Antigravity bridge script is missing; reinstall OpenMAIC or set ANTIGRAVITY_BRIDGE.',
    };
  }

  try {
    await execFileAsync(
      settings.pythonPath || 'python3',
      ['-c', 'import google.antigravity; print(google.antigravity.__name__)'],
      {
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      },
    );
  } catch (error) {
    const detail = describeAntigravityError(error);
    return {
      bridge: true,
      installed: false,
      authenticated: isAntigravityAuthConfigured(settings),
      message:
        `Antigravity SDK is not installed for ${settings.pythonPath || 'python3'}. ` +
        `Run \`pip install google-antigravity\` (or ./install.sh) — ${detail}`,
    };
  }

  const authenticated = isAntigravityAuthConfigured(settings);
  return {
    bridge: true,
    installed: true,
    authenticated,
    message: authenticated
      ? 'Antigravity SDK is installed and credentials are configured.'
      : 'Antigravity SDK is installed, but GEMINI_API_KEY (or Vertex credentials) is not set.',
  };
}

/** Whether a turn can start: bridge, SDK import and credentials. */
export async function antigravitySdkAvailability(
  settings: AntigravitySdkSettings = antigravitySdkSettingsFromEnv(),
): Promise<{ available: true } | { available: false; reason: string }> {
  const status = await antigravityPythonStatus(settings);
  if (!status.bridge || !status.installed) return { available: false, reason: status.message };
  if (!status.authenticated) {
    return {
      available: false,
      reason:
        'The Antigravity transport needs GEMINI_API_KEY (or GOOGLE_API_KEY), or Vertex AI ' +
        'credentials via GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_LOCATION. ' +
        'Set one in .env.local, then restart the server.',
    };
  }
  return { available: true };
}

/** Turn a bridge/spawn failure into an actionable operator message. */
export function describeAntigravityError(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as { code?: unknown; message?: unknown; stderr?: unknown };
    if (record.code === 'ENOENT') {
      return (
        'The Antigravity Python interpreter was not found. Install Python 3.10+ or set ' +
        'ANTIGRAVITY_PYTHON to its absolute path (./install.sh creates .venv-antigravity).'
      );
    }
    const message =
      typeof record.message === 'string' && record.message.trim()
        ? record.message.trim()
        : typeof record.stderr === 'string' && record.stderr.trim()
          ? record.stderr.trim()
          : '';
    if (message) return message;
  }
  return error instanceof Error && error.message.trim()
    ? error.message
    : typeof error === 'string' && error.trim()
      ? error
      : 'Antigravity turn failed.';
}

function bridgeRequest(
  settings: AntigravitySdkSettings,
  request: AntigravityTurnRequest,
): Record<string, unknown> {
  return {
    model: request.model || settings.model || ANTIGRAVITY_SDK_DEFAULT_MODEL,
    apiKey: settings.apiKey ?? null,
    vertex: settings.vertex === true,
    project: settings.project ?? null,
    location: settings.location ?? null,
    systemInstructions: request.systemInstructions,
    prompt: request.prompt,
    responseSchema: request.responseSchema,
    thinkingLevel: request.thinkingLevel ?? null,
    maxOutputTokens: request.maxOutputTokens ?? settings.maxOutputTokens ?? null,
    timeoutMs: request.timeoutMs ?? settings.timeoutMs ?? ANTIGRAVITY_SDK_DEFAULT_TIMEOUT_MS,
  };
}

function parseBridgeOutput(stdout: string): AntigravityTurnResult {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]!);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    if (typeof record.error === 'string' && record.error.trim()) {
      throw new Error(record.error.trim());
    }
    return {
      text: typeof record.text === 'string' ? record.text : '',
      structured: record.structured ?? null,
      usage:
        record.usage && typeof record.usage === 'object'
          ? (record.usage as AntigravityUsage)
          : null,
      stopReason: typeof record.stopReason === 'string' ? record.stopReason : null,
    };
  }
  throw new Error(
    `Antigravity bridge returned no JSON response${stdout.trim() ? `: ${stdout.trim().slice(0, 500)}` : '.'}`,
  );
}

/**
 * Run exactly one Antigravity turn. The child is killed on abort or timeout;
 * its stdout is the protocol channel and stderr is kept for diagnostics.
 */
export async function runAntigravityTurn(
  request: AntigravityTurnRequest,
  settings: AntigravitySdkSettings = antigravitySdkSettingsFromEnv(),
): Promise<AntigravityTurnResult> {
  if (!settings.bridgePath || !fs.existsSync(/*turbopackIgnore: true*/ settings.bridgePath)) {
    throw new Error(
      'Antigravity bridge script not found. Reinstall OpenMAIC or set ANTIGRAVITY_BRIDGE.',
    );
  }
  const timeoutMs = request.timeoutMs ?? settings.timeoutMs ?? ANTIGRAVITY_SDK_DEFAULT_TIMEOUT_MS;
  const payload = JSON.stringify(bridgeRequest(settings, request));
  const pythonPath = settings.pythonPath || 'python3';
  const bridgePath = settings.bridgePath;

  return await new Promise<AntigravityTurnResult>((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(pythonPath, [bridgePath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          NO_COLOR: '1',
        },
      });
    } catch (error) {
      reject(new Error(describeAntigravityError(error)));
      return;
    }

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const kill = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        // The process may already be gone.
      }
    };
    const onAbort = () => {
      kill();
      settle(() => reject(new Error('Antigravity turn aborted.')));
    };
    const timer = setTimeout(() => {
      kill();
      settle(() =>
        reject(new Error(`Antigravity turn timed out after ${Math.round(timeoutMs / 1000)}s.`)),
      );
    }, timeoutMs);
    timer.unref?.();

    if (request.signal?.aborted) {
      onAbort();
      return;
    }
    request.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_BRIDGE_OUTPUT_BYTES) {
        kill();
        settle(() => reject(new Error('Antigravity bridge output exceeded the 32 MiB limit.')));
      }
    });
    child.stderr.on('data', (chunk: string) => {
      // Keep the tail only: a failing SDK is noisy but the last lines carry
      // the actionable error.
      stderr = (stderr + chunk).slice(-16_384);
    });
    child.on('error', (error) => settle(() => reject(new Error(describeAntigravityError(error)))));
    child.on('close', () => {
      settle(() => {
        try {
          resolve(parseBridgeOutput(stdout));
        } catch (error) {
          const detail = stderr.trim() ? ` SDK stderr: ${stderr.trim().slice(-2_000)}` : '';
          reject(
            new Error(`${error instanceof Error ? error.message : String(error)}${detail}`.trim()),
          );
        }
      });
    });

    child.stdin.on('error', () => {
      // EPIPE is reported by `close`/`error` with the real cause.
    });
    child.stdin.end(payload);
  });
}

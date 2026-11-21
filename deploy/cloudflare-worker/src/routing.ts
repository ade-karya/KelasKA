/**
 * The route split.
 *
 * Legacy mode (STATIC_UI_ENABLED off): Vercel serves one static status page,
 * every page and API route goes to the full Next.js app on Colab behind `api.`.
 * The Worker's own `/__kelaska/*` endpoints stay on the edge.
 *
 * Static-UI mode (STATIC_UI_ENABLED on): the SPA is served from Vercel, so
 * every non-API path goes there and every `/api/*` path goes to the live
 * session (Kaggle app first, Colab fallback). The start button is handled by
 * the Worker itself, since the session is asleep when it is pressed.
 *
 * In both modes a generation start is parked in the KV queue while the backend
 * is offline and replayed with the browser's own session cookie later.
 */

import { staticUiEnabled } from './session-mode';
import type { Env, Upstream } from './types';

/** Paths whose request body is small enough to park in KV while Colab wakes. */
const QUEUEABLE_PATHS = new Set<string>(['/api/generation-runs']);

/** Heavy paths that are worth starting the Kaggle GPU box for. */
const GPU_PATHS = [
  '/api/generate/image',
  '/api/generate/tts',
  '/api/generate/video',
  '/api/generate/voice',
  '/api/transcription',
  '/api/chat/',
  '/api/agent/',
];

export function isWorkerPath(pathname: string): boolean {
  return pathname === '/__kelaska' || pathname.startsWith('/__kelaska/');
}

/**
 * Legacy mode: everything goes to the Colab app. Static-UI mode: pages and
 * assets go to Vercel, API calls go to the live app session.
 */
export function upstreamFor(pathname: string, _method: string, env: Env): Upstream {
  if (!staticUiEnabled(env)) return 'colab';
  return pathname.startsWith('/api/') ? 'session' : 'vercel';
}

export function isDocumentRequest(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  return (request.headers.get('accept') ?? '').includes('text/html');
}

export function isQueueableStart(pathname: string, method: string): boolean {
  return method === 'POST' && QUEUEABLE_PATHS.has(pathname);
}

export function needsGpu(pathname: string, method: string): boolean {
  if (pathname === '/api/generation-runs') return method === 'POST';
  if (pathname === '/api/generate-classroom') return method === 'POST';
  if (method !== 'POST' && method !== 'PUT') return false;
  return GPU_PATHS.some((prefix) => pathname.startsWith(prefix));
}

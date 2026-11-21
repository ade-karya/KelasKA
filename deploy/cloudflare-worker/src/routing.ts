/**
 * The route split.
 *
 * Vercel is on the Hobby plan, which allows only 12 Serverless Functions while
 * this app has ~126 API routes. So Vercel serves one static status page only;
 * every page and every API route is proxied to the full Next.js app on Colab
 * behind `api.`. The Worker's own `/__kelaska/*` endpoints stay on the edge.
 *
 * When Colab is offline, document requests fall back to the static Vercel
 * status page (it shows the queue and asks the operator to start Colab), and
 * generation starts are parked in the KV queue for automatic replay.
 */

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

/** Everything that is not a Worker endpoint goes to the Colab app. */
export function upstreamFor(_pathname: string, _method: string): 'vercel' | 'colab' {
  return 'colab';
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

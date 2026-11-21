/**
 * The route split.
 *
 * Vercel keeps the UI and the APIs that are cheap, short-lived, and needed
 * before any heavy backend exists: auth, accounts, folders, library listings,
 * model settings, health. Everything that can run for minutes, stream, touch a
 * GPU, or hold a large body goes to the Colab app behind `api.`.
 *
 * Defaulting unknown `/api/*` routes to Vercel is deliberate: a new light route
 * keeps working when Colab is asleep, and a new heavy route is one prefix away
 * from being moved. The list below is the complete current split.
 */

const HEAVY_EXACT = new Set<string>([
  '/api/agent',
  '/api/parse-pdf',
  '/api/transcription',
  '/api/proxy-media',
  '/api/quiz-grade',
]);

const HEAVY_PREFIXES = [
  '/api/generate/',
  '/api/chat/',
  '/api/agent/',
  '/api/pbl/',
  '/api/sandbox/',
  '/api/export-video/render',
  '/api/classroom-media/',
  '/api/persistence/',
];

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

export function isHeavyApi(pathname: string, method: string): boolean {
  // Snapshot reads of runs live in Postgres, so Vercel can answer them while
  // Colab is asleep. Events are SSE from the in-process run engine and every
  // command (confirm/retry/…) has to wake that engine, so those stay on Colab.
  if (pathname.startsWith('/api/generation-runs')) {
    if (method === 'GET' || method === 'HEAD') {
      return pathname === '/api/generation-runs/events' || pathname.endsWith('/events');
    }
    return true;
  }
  // The model picker and the key-verification gate run before any generation
  // and must work when the heavy backend is offline.
  if (pathname === '/api/agent/models') return false;

  // Capabilities is a cheap policy read; the rest of the generation route is
  // the long-running job surface.
  if (pathname === '/api/generate-classroom/capabilities') return false;
  if (pathname.startsWith('/api/generate-classroom')) return true;

  // Uploading/extraction is heavy; listing, reading and moving are DB/S3 work.
  if (pathname === '/api/materials' && method === 'POST') return true;
  if (pathname.startsWith('/api/materials/') && pathname.endsWith('/extraction')) return true;

  if (HEAVY_EXACT.has(pathname)) return true;
  return HEAVY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function upstreamFor(pathname: string, method: string): 'vercel' | 'colab' {
  return isHeavyApi(pathname, method) ? 'colab' : 'vercel';
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

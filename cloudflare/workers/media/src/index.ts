/**
 * Worker media — media-kelas.riau.ai
 *
 * Melayani byte media dari HF S3 tanpa melewati Vercel:
 *   1. verifikasi token HMAC yang dibuat Vercel (TTL ≤10 menit),
 *   2. tanda tangani permintaan S3 dengan SigV4 (query presign, ≤600 s),
 *   3. teruskan Range/CORS dan cache objek content-addressed.
 *
 * Worker tidak mencatat URL bertanda tangan ke log.
 */
interface Env {
  MEDIA_TOKEN_SECRET: string;
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  ALLOWED_ORIGIN: string;
}

const encoder = new TextEncoder();
const S3_REGION = 'us-east-1';
const PRESIGN_SECONDS = 600;
const ALLOWED_PREFIXES = ['assets/', 'materials/', 'exports/'];

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodePath(path: string): string {
  return path.split('/').map(encodeRfc3986).join('/');
}

async function hmac(key: ArrayBuffer | Uint8Array | string, data: string): Promise<ArrayBuffer> {
  const raw = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(data)));
}

function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function tokenValid(
  path: string,
  exp: string,
  sig: string,
  secret: string,
): Promise<boolean> {
  const expiry = Number(exp);
  if (!Number.isSafeInteger(expiry) || expiry <= Math.floor(Date.now() / 1000)) return false;
  return equalHex(hex(await hmac(secret, `${path}|${exp}`)), sig.toLowerCase());
}

async function presign(
  env: Env,
  key: string,
  method: string,
  range?: string | null,
): Promise<string> {
  const endpoint = new URL(env.S3_ENDPOINT);
  const basePath = endpoint.pathname.replace(/\/$/, '');
  endpoint.pathname = `${basePath}/${env.S3_BUCKET}/${encodePath(key)}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${S3_REGION}/s3/aws4_request`;

  const signedHeaders = range ? 'host;range' : 'host';
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${env.S3_ACCESS_KEY_ID}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(PRESIGN_SECONDS),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(query[name]!)}`)
    .join('&');

  const canonicalHeaders = `host:${endpoint.host}\n${range ? `range:${range}\n` : ''}`;
  const canonicalRequest = [
    method,
    endpoint.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join(
    '\n',
  );

  const kDate = await hmac(`AWS4${env.S3_SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = await hmac(kDate, S3_REGION);
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = hex(await hmac(kSigning, stringToSign));

  return `${endpoint.origin}${endpoint.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function cors(env: Env, cacheable: boolean): Record<string, string> {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN,
    'access-control-allow-methods': 'GET, HEAD',
    'access-control-expose-headers':
      'Content-Type, Content-Length, ETag, Accept-Ranges, Content-Range',
    'access-control-max-age': '86400',
    vary: 'Origin',
    'cache-control': cacheable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: cors(env, false) });
    }

    let key: string;
    try {
      key = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return new Response('Bad Request', { status: 400, headers: cors(env, false) });
    }
    if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix)) || key.includes('..')) {
      return new Response('Forbidden', { status: 403, headers: cors(env, false) });
    }

    const exp = url.searchParams.get('exp') ?? '';
    const sig = url.searchParams.get('sig') ?? '';
    if (!(await tokenValid(key, exp, sig, env.MEDIA_TOKEN_SECRET))) {
      return new Response('Unauthorized', { status: 401, headers: cors(env, false) });
    }

    const range = request.headers.get('range');
    const signedUrl = await presign(env, key, request.method, range);
    const upstream = await fetch(signedUrl, {
      method: request.method,
      headers: range ? { range } : undefined,
    });
    const headers = cors(env, key.startsWith('assets/'));
    for (const name of [
      'content-type',
      'content-length',
      'etag',
      'accept-ranges',
      'content-range',
    ]) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

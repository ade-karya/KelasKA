import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

import { authEnabled } from '@/lib/server/auth/config';
import { sessionUserFromHeaders } from '@/lib/server/auth/session';

/**
 * Serve the statically exported Fumadocs site (`packages/docs`) at `/docs`.
 *
 * The docs package is a separate Next app with `output: 'export'` and
 * `basePath: '/docs'`, built into `public/docs-site` by
 * `scripts/build-docs.sh` (called from `install.sh`). Its HTML pages are
 * written as `getting-started.html`, but every internal link is
 * extension-less (`/docs/getting-started`), so this handler resolves the same
 * way a static host's `try_files` would.
 *
 * The files are read from `<cwd>/public/docs-site`, which works both for
 * `next start` and for the standalone PM2 deployment (install.sh copies
 * `public/` into `.next/standalone/public`).
 *
 * Docs are an admin-only surface when accounts are enabled. The edge proxy's
 * matcher deliberately excludes `/docs`, so this handler is the gate: it reads
 * the role from the database on every request and answers 404 for everyone
 * else (including signed-out browsers). Without accounts there is no role to
 * check — the deployment's single anonymous owner keeps access.
 */
const SITE_ROOT = path.join(process.cwd(), 'public', 'docs-site');

// Files are copied into the standalone tree after `next build` (install.sh
// sync step), so they must be read per request, never snapshotted at build.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Read a regular file inside the export root; `null` when it does not exist. */
async function readSiteFile(file: string): Promise<Buffer | null> {
  const resolved = path.resolve(SITE_ROOT, file);
  // Never escape the export root, even if a caller sneaks in `..`.
  if (resolved !== SITE_ROOT && !resolved.startsWith(`${SITE_ROOT}${path.sep}`)) {
    return null;
  }
  try {
    const info = await stat(resolved);
    if (!info.isFile()) return null;
    return await readFile(resolved);
  } catch {
    return null;
  }
}

function responseFor(
  file: string,
  body: Buffer,
  { status = 200, cacheControl }: { status?: number; cacheControl?: string } = {},
): NextResponse {
  const immutable = file.startsWith('_next/static/');
  const headers = new Headers({
    'Content-Type': contentTypeFor(file),
    // Admin-only bytes must never be stored by a shared cache.
    'Cache-Control':
      cacheControl ??
      (immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate'),
    'X-Content-Type-Options': 'nosniff',
  });
  // The exported pages are self-contained; nothing here needs a session.
  // Copy into a fresh Uint8Array so the body type is a plain ArrayBuffer view.
  const bytes = new Uint8Array(body.byteLength);
  bytes.set(body);
  return new NextResponse(bytes, { status, headers });
}

function docsNotBuilt(): NextResponse {
  return new NextResponse(
    `<!doctype html><html lang="id"><meta charset="utf-8"><title>Dokumentasi belum dibangun — Kelas Kecerdasan Artifisial</title>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.6">
<h1>Dokumentasi belum dibangun</h1>
<p>Situs dokumentasi belum tersedia di server ini. Jalankan
<code>bash scripts/build-docs.sh</code> lalu build ulang aplikasi
(<code>bash install.sh --colab</code>), atau lihat isi dokumentasi langsung di
<code>packages/docs/content/docs</code>.</p>
<p lang="en"><em>The documentation site has not been built on this server yet.</em></p>
</body></html>`,
    {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
): Promise<NextResponse> {
  const adminOnly = authEnabled();
  if (adminOnly) {
    // The proxy's matcher excludes /docs, so this is the only auth gate.
    // The role comes from the database, not the cookie, so a demotion applies
    // on the next request even with an otherwise valid session.
    const user = await sessionUserFromHeaders(request.headers);
    if (user?.role !== 'admin') {
      return new NextResponse('Not found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
  }
  const serve = (file: string, body: Buffer, status?: number) =>
    responseFor(file, body, {
      ...(status ? { status } : {}),
      cacheControl: adminOnly ? 'private, no-store' : undefined,
    });

  const { slug } = await params;
  const segments = slug ?? [];

  // Route params are decoded already; anything that could traverse stays out.
  if (
    segments.some(
      (segment) =>
        segment === '' ||
        segment.includes('..') ||
        segment.includes('\0') ||
        segment.includes('/') ||
        segment.includes('\\'),
    )
  ) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const rootIndex = await readSiteFile('index.html');
  if (!rootIndex) return docsNotBuilt();

  if (segments.length === 0) return serve('index.html', rootIndex);

  const rel = segments.join('/');
  const candidates: string[] = [];
  if (path.extname(rel)) candidates.push(rel);
  candidates.push(`${rel}.html`, `${rel}/index.html`);

  for (const candidate of candidates) {
    const body = await readSiteFile(candidate);
    if (body) return serve(candidate, body);
  }

  // Unknown docs path: show the export's own 404 page when it has one.
  const notFound = await readSiteFile('404.html');
  if (notFound) return serve('404.html', notFound, 404);
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

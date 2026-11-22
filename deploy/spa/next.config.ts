import type { NextConfig } from 'next';

/**
 * Static SPA shell served from Vercel behind the Cloudflare Worker.
 *
 * No headers(), rewrites(), redirects(), proxy, route handlers, cookies() or
 * dynamic routes: none of them survive `output: 'export'` (see
 * node_modules/next/dist/docs/01-app/02-guides/static-exports.md). Security
 * headers and all /api/* routing are the Worker's job.
 */
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;

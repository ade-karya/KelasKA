import type { MetadataRoute } from 'next';

// Only the genuinely public, unauthenticated surfaces belong in the sitemap.
// Everything else sits behind the access-code gate (or is per-owner state).
// Docs are intentionally absent: with accounts on they are admin-only.
export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://kelaska.riau.ai';
  return [{ url: `${base}/`, changeFrequency: 'weekly', priority: 1 }];
}

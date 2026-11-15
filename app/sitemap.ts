import type { MetadataRoute } from 'next';

// Only the genuinely public, unauthenticated surfaces belong in the sitemap.
// Everything else sits behind the access-code gate (or is per-owner state).
export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://kelaska.riau.ai';
  return [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/docs/getting-started`, changeFrequency: 'monthly', priority: 0.6 },
  ];
}

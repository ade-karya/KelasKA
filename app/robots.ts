import type { MetadataRoute } from 'next';

// This route only renders because the Cloudflare-managed robots.txt on the
// production zone (AI content-signals preamble) has no Sitemap pointer. This
// one keeps the deployment self-describing; if the zone keeps overriding it at
// the edge, nothing breaks — crawlers just keep their current behaviour.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: 'https://kelaska.riau.ai/sitemap.xml',
  };
}

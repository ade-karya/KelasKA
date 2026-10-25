import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';

const nextConfig: NextConfig = {
  // Keep Next dev from creating or rewriting repository agent instructions.
  agentRules: false,
  output: 'standalone',
  env: {
    INTERACTIVE_ASSET_BASE_URL:
      process.env.INTERACTIVE_ASSET_BASE_URL?.trim() || '/vendor/interactive',
  },
  outputFileTracingIncludes: {
    '/*': [
      'lib/server/agent-runtime/import-pptx-worker.mjs',
      // @openmaic/generation reads these Markdown prompts at runtime via
      // readFileSync with a computed path (packages' prompts-pbl/loader.ts),
      // so the tracer never sees them. Without this, standalone builds ship
      // without PBL planner prompts and EVERY PBL scene fails with ENOENT
      // (2026-10-08: run run-nEW-x01TrGcMu6yD paused 9x on scene:4:content).
      // templates/ + snippets/ are traced today, but keep them listed here
      // too so a tracer change cannot silently break slide generation either.
      'packages/@openmaic/generation/prompts-pbl/**',
      'packages/@openmaic/generation/templates/**',
      'packages/@openmaic/generation/snippets/**',
      'skills/openmaic/**',
      'skills/agent-runtime/**',
      // Loaded through a runtime-only `import('undici')` (see the LLM
      // dispatcher in lib/ai/providers.ts and the Google proxy transport), so
      // the output tracer never sees it and standalone builds ship without it.
      'node_modules/undici/**',
      // sharp's native libvips libraries are loaded via dlopen and are not
      // statically analyzable, so Next.js standalone tracing omits them. Two
      // sharp versions resolve in the tree (0.34.5 transitive -> libvips
      // 1.2.4, 0.35.4 direct -> libvips 1.3.3); tracing picked the wrong one
      // and the runtime dlopen of sharp 0.35.4 failed with
      // "libvips-cpp.so.8.18.6: No such file or directory" on self-hosted
      // Docker (Alpine/musl) deployments. Force-include every sharp-libvips
      // native lib dir.
      'node_modules/.pnpm/@img+sharp-libvips-*/node_modules/@img/sharp-libvips-*/lib/**',
    ],
  },
  typescript: {
    tsconfigPath: process.env.NODE_ENV === 'production' ? 'tsconfig.build.json' : 'tsconfig.json',
    // Installer/Colab builds are dominated by the TypeScript pass (~2.5 min on a
    // 2-vCPU runtime). Set OPENMAIC_SKIP_TYPECHECK=1 to skip it for throwaway
    // deployments; CI and release builds keep the check (the default).
    ignoreBuildErrors: process.env.OPENMAIC_SKIP_TYPECHECK === '1',
  },
  transpilePackages: ['mathml2omml', 'pptxgenjs', '@openmaic/importer'],
  // These agent packages do a runtime `import(specifier)` with a computed
  // specifier (to lazily load node:fs/os/path without breaking browser/Vite
  // builds). webpack can't statically analyze that and bundling it throws
  // "Cannot find module as expression is too dynamic" at runtime on the server
  // (the "Edit with AI" Pro-mode path), which broke the #619 keep-alive e2e.
  // Mark them server-external so Next loads them natively and the dynamic
  // import resolves as a real Node call.
  serverExternalPackages: [
    '@earendil-works/pi-ai',
    '@earendil-works/pi-agent-core',
    '@openmaic/generation',
    // Optional peers of @openmaic/storage, reached through deliberately
    // untraced dynamic imports. Externalizing keeps them out of the bundle,
    // and the static anchor in lib/persistence/asset-byte-store.ts gets them
    // traced into the standalone image -- without it, S3 mode and redirect
    // egress cannot resolve their SDK in the shipped deployment.
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
  ],
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
  allowedDevOrigins: ['kelaska.riau.ai'],
  async rewrites() {
    return [
      // public/ files are served as-is, so `/wireframes/` has no directory
      // index. Map the folder URL to the standalone document explicitly.
      { source: '/wireframes', destination: '/wireframes/index.html' },
    ];
  },
  async headers() {
    const extraAncestors = process.env.ALLOWED_FRAME_ANCESTORS?.trim();
    const frameAncestors = extraAncestors ? `'self' ${extraAncestors}` : "'self'";

    return [
      {
        source: '/vendor/interactive/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          // X-Frame-Options only supports SAMEORIGIN (no allow-list),
          // so we omit it when custom ancestors are configured.
          ...(!extraAncestors ? [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] : []),
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${frameAncestors}`,
          },
        ],
      },
      {
        // Provider logos are drawn wherever services are listed, and each tab
        // switch mounts a fresh set of them. With Next's default `max-age=0`
        // every one is revalidated first and stays blank until the server
        // answers. Most are not content-hashed, so cache for a day, not
        // forever (deepseek carries a content hash in its filename, so a new
        // whale is a new URL on every cache layer).
        source: '/logos/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
    ];
  },
};

// NEXT_PUBLIC_PI_CHAT_ENABLED used to opt out of Pi into the legacy
// director-graph classroom chat. That runtime is gone, so a production build
// that still carries any value which once selected it fails instead of
// silently switching the deployment to Pi. These values never did.
const PI_CHAT_FLAG_VALUES_STILL_ACCEPTED = new Set(['', 'true', '1']);

export default function config(phase: string): NextConfig {
  const piChatFlag = process.env.NEXT_PUBLIC_PI_CHAT_ENABLED;
  if (
    phase === PHASE_PRODUCTION_BUILD &&
    piChatFlag !== undefined &&
    !PI_CHAT_FLAG_VALUES_STILL_ACCEPTED.has(piChatFlag)
  ) {
    throw new Error(
      `NEXT_PUBLIC_PI_CHAT_ENABLED is set to ${JSON.stringify(piChatFlag)}, but the legacy ` +
        'director-graph classroom chat has been removed and this variable can no longer ' +
        'select it. Remove NEXT_PUBLIC_PI_CHAT_ENABLED, then select a model that supports ' +
        'tool calling for Classroom (Settings → Course Model Config, or the `classroom` ' +
        'slot in openmaic.yml and the `llm` slot it inherits from). For Gemini, use the ' +
        'native `google` preset. If the model configuration is managed by an administrator, ' +
        'ask them to make this change.',
    );
  }
  return nextConfig;
}

/**
 * Vercel build helper: materialise openmaic.yml from a base64 secret, or from
 * the tracked Vercel template when no secret is set.
 *
 * The real config is git-ignored and holds ${ENV_VAR} placeholders, never the
 * secrets themselves. The template in `deploy/vercel/openmaic.yml` is safe to
 * commit for the same reason: keys stay in the environment. On deployments
 * that prefer the legacy env providers (self-hosted, Kaggle), leave both the
 * env var and the template alone; this is then a no-op and the app falls back
 * to GOOGLE_API_KEY / GOOGLE_MODELS as before.
 */
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';

const CONFIG = 'openmaic.yml';
const VERCEL_TEMPLATE = 'deploy/vercel/openmaic.yml';
const encoded = process.env.OPENMAIC_YML_B64?.trim();

if (encoded) {
  let content;
  try {
    content = Buffer.from(encoded, 'base64').toString('utf8');
  } catch (error) {
    throw new Error(`OPENMAIC_YML_B64 is not valid base64: ${error.message}`);
  }
  if (!content.includes('providers:') || !content.includes('slots:')) {
    throw new Error(
      'OPENMAIC_YML_B64 does not look like an openmaic.yml (missing providers/slots)',
    );
  }
  if (/\b(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,})\b/.test(content)) {
    throw new Error(
      'OPENMAIC_YML_B64 contains an API key literal; use ${VAR} placeholders instead',
    );
  }
  writeFileSync(CONFIG, content, { mode: 0o600 });
  console.log('[openmaic] wrote openmaic.yml from OPENMAIC_YML_B64');
} else if (process.env.VERCEL && !existsSync(CONFIG) && existsSync(VERCEL_TEMPLATE)) {
  copyFileSync(VERCEL_TEMPLATE, CONFIG, { mode: 0o600 });
  console.log(`[openmaic] wrote openmaic.yml from ${VERCEL_TEMPLATE}`);
} else {
  console.log('[openmaic] OPENMAIC_YML_B64 not set; using environment provider config');
}

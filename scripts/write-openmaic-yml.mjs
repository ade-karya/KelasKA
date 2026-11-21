/**
 * Vercel build helper: materialise openmaic.yml from a base64 secret.
 *
 * The real config is git-ignored and holds ${ENV_VAR} placeholders, never the
 * secrets themselves. On deployments that prefer the legacy env providers,
 * leave OPENMAIC_YML_B64 unset; this is then a no-op and the app falls back to
 * GOOGLE_API_KEY / GOOGLE_MODELS as before.
 */
import { writeFileSync } from 'node:fs';

const encoded = process.env.OPENMAIC_YML_B64?.trim();
if (!encoded) {
  console.log('[openmaic] OPENMAIC_YML_B64 not set; using environment provider config');
  process.exit(0);
}

let content;
try {
  content = Buffer.from(encoded, 'base64').toString('utf8');
} catch (error) {
  throw new Error(`OPENMAIC_YML_B64 is not valid base64: ${error.message}`);
}
if (!content.includes('providers:') || !content.includes('slots:')) {
  throw new Error('OPENMAIC_YML_B64 does not look like an openmaic.yml (missing providers/slots)');
}
if (/\b(AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,})\b/.test(content)) {
  throw new Error('OPENMAIC_YML_B64 contains an API key literal; use ${VAR} placeholders instead');
}
writeFileSync('openmaic.yml', content, { mode: 0o600 });
console.log('[openmaic] wrote openmaic.yml from OPENMAIC_YML_B64');

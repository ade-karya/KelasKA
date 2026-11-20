/**
 * Cloudflare Containers entrypoint: one long-lived container running the
 * repository's Dockerfile, behind a Durable Object that proxies HTTP to it.
 *
 * The container is a normal Node process, so it can serve the whole Next.js
 * app. It runs in "limited" mode: `OPENMAIC_DEPLOY_TARGET=cloudflare` makes
 * `instrumentation.node.ts` skip the in-process runners, and a separate worker
 * host sharing DATABASE_URL claims the generation runs (deploy/README.md).
 *
 * Cloudflare Workers does not automatically pass Worker env bindings to the
 * container, so the curated list below is forwarded as container env vars.
 * Put secrets in with `wrangler secret put <KEY>`; never in wrangler.jsonc.
 */
import { Container } from '@cloudflare/containers';

interface ContainerStub {
  fetch(request: Request): Promise<Response>;
}

interface ContainerNamespace {
  /** The container-enabled namespace exposes getByName on the binding. */
  getByName(name: string): ContainerStub;
}

interface KelasKaEnv {
  KELASKA_CONTAINER: ContainerNamespace;
  /** Optional JSON object of extra container env keys (strings/numbers/bools). */
  KELASKA_EXTRA_ENV?: string;
  [key: string]: unknown;
}

/** Runtime configuration the container needs. NEXT_PUBLIC_* are compile-time
 * and listed only so an operator does not expect a runtime change to work;
 * they must be set when the image is built. */
const PASSTHROUGH_KEYS = [
  'DATABASE_URL',
  'OPENMAIC_SECRET_KEY',
  'ACCESS_CODE',
  'AUTH_ENABLED',
  'AUTH_SECRET',
  'AUTH_PUBLIC_URL',
  'AUTH_ADMIN_EMAILS',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_PERSISTENCE',
  'GOOGLE_API_KEY',
  'GOOGLE_MODELS',
  'HF_S3_BUCKET',
  'HF_S3_ENDPOINT',
  'HF_S3_REGION',
  'HF_S3_ACCESS_KEY_ID',
  'HF_S3_SECRET_ACCESS_KEY',
  'TTS_BROWSER_NATIVE_ENABLED',
  'IMAGE_COMFYUI_ENABLED',
] as const;

function containerEnv(env: KelasKaEnv): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of PASSTHROUGH_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.length > 0) values[key] = value;
  }

  const rawExtra = env.KELASKA_EXTRA_ENV?.trim();
  if (rawExtra) {
    try {
      const parsed: unknown = JSON.parse(rawExtra);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            values[key] = String(value);
          }
        }
      }
    } catch (error) {
      console.error('KELASKA_EXTRA_ENV is not a JSON object', error);
    }
  }

  // Set last: the deployment profile must not be overridable by the extras.
  values.NODE_ENV = 'production';
  values.PORT = '3000';
  values.HOSTNAME = '0.0.0.0';
  values.OPENMAIC_DEPLOY_TARGET = 'cloudflare';
  return values;
}

export class KelasKaContainer extends Container<KelasKaEnv> {
  defaultPort = 3000;
  sleepAfter = '2h';
  enableInternet = true;
  pingEndpoint = '/api/health';

  // `DurableObject<Env, Props = {}>` types its ctx as DurableObjectState<Props>.
  constructor(ctx: DurableObjectState<{}>, env: KelasKaEnv) {
    super(ctx, env);
    this.envVars = containerEnv(env);
  }
}

export default {
  async fetch(request: Request, env: KelasKaEnv): Promise<Response> {
    // One named container: this deployment is a single app instance, not a
    // multi-tenant pool. Scale by raising max_instances plus a load balancer.
    return env.KELASKA_CONTAINER.getByName('kelaska').fetch(request);
  },
};

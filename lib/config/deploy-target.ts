/**
 * Where this deployment runs, and what the host is able to do.
 *
 * The application is one Next.js codebase with several deployment profiles.
 * The profile is selected by `OPENMAIC_DEPLOY_TARGET` when set explicitly, and
 * otherwise inferred from the host's own environment variables. It is read at
 * process runtime (never baked into the browser bundle): serverless hosts end
 * with the request, so they must not start the long-lived workers that claim
 * generation runs and drain schedules. Those deployments serve the UI, the
 * course library and the DB-backed APIs; a separate long-running worker host
 * sharing the same `DATABASE_URL` executes the runs they enqueue. See
 * `deploy/README.md` for the full matrix and the per-platform setup.
 *
 * This module is deliberately free of `node:*` imports so it can be read from
 * `next.config.ts` (build time), the Node-only instrumentation file and tests
 * alike. Only string environment values are used.
 */

export const DEPLOY_TARGETS = ['self-hosted', 'vercel', 'cloudflare', 'kaggle', 'colab'] as const;

export type DeployTarget = (typeof DEPLOY_TARGETS)[number];

/** The explicit operator-set variable; takes precedence over auto-detection. */
export const DEPLOY_TARGET_ENV = 'OPENMAIC_DEPLOY_TARGET';

type Env = Readonly<Record<string, string | undefined>>;

const SERVERLESS_TARGETS: readonly DeployTarget[] = ['vercel', 'cloudflare'];

function isDeployTargetValue(value: string): value is DeployTarget {
  return (DEPLOY_TARGETS as readonly string[]).includes(value);
}

/** Read and validate the explicit variable. `null` means "not set". */
function explicitTarget(env: Env): DeployTarget | null {
  const raw = env[DEPLOY_TARGET_ENV]?.trim().toLowerCase();
  if (!raw) return null;
  if (isDeployTargetValue(raw)) return raw;
  throw new Error(
    `${DEPLOY_TARGET_ENV} must be one of ${DEPLOY_TARGETS.join(', ')}; got ${JSON.stringify(raw)}.`,
  );
}

/**
 * Infer the target from the variables the platforms set on their own. Vercel
 * exports `VERCEL`; Cloudflare exports `CF_PAGES`/`WORKERS_CI`; Kaggle and
 * Colab export their kernel/runtime markers. An explicit value always wins,
 * so an operator can override a wrong guess in the platform's env settings.
 */
function detectTarget(env: Env): DeployTarget {
  if (env.VERCEL === '1' || env.VERCEL === 'true') return 'vercel';
  if (env.CF_PAGES === '1' || env.CF_PAGES === 'true' || env.WORKERS_CI === '1') {
    return 'cloudflare';
  }
  if (env.KAGGLE_KERNEL_RUN_TYPE || env.KAGGLE_URL_BASE) return 'kaggle';
  if (env.COLAB_RELEASE_TAG || env.COLAB_BACKEND_VERSION) return 'colab';
  return 'self-hosted';
}

export function resolveDeployTarget(env: Env = process.env): DeployTarget {
  return explicitTarget(env) ?? detectTarget(env);
}

export function isServerlessTarget(target: DeployTarget = resolveDeployTarget()): boolean {
  return SERVERLESS_TARGETS.includes(target);
}

export interface DeployCapabilities {
  target: DeployTarget;
  /** The process ends with the request (Vercel functions, Cloudflare Workers). */
  serverless: boolean;
  /** Timers may claim runs and drain schedules in this process. */
  backgroundWorkers: boolean;
  /** Child processes (agent CLIs, the render service) may be spawned. */
  localProcesses: boolean;
  /** Writes under the project directory survive between requests. */
  durableLocalFilesystem: boolean;
  /** Local GPU media endpoints (Ollama/ComfyUI/FunASR/VoxCPM) may be configured. */
  localMediaProvidersAllowed: boolean;
  /** A separate long-running host must execute the runs enqueued here. */
  externalWorkerRequired: boolean;
}

export function deployCapabilities(
  target: DeployTarget = resolveDeployTarget(),
): DeployCapabilities {
  const serverless = isServerlessTarget(target);
  return {
    target,
    serverless,
    backgroundWorkers: !serverless,
    localProcesses: !serverless,
    durableLocalFilesystem: !serverless,
    localMediaProvidersAllowed: !serverless,
    externalWorkerRequired: serverless,
  };
}

/** Convenience wrapper used by `next.config.ts` and the boot instrumentation. */
export function isServerlessDeploy(): boolean {
  return isServerlessTarget();
}

/** Whether `registerNode` may start the in-process runners and schedules. */
export function runsBackgroundWorkers(): boolean {
  return deployCapabilities().backgroundWorkers;
}

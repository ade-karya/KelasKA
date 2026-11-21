/** Bindings and secrets the edge Worker needs. */
export interface Env {
  /** KV: health, lease, queue metadata, cached kernel source. */
  STATE: KVNamespace;
  /** Durable Object: single-flight Kaggle lifecycle. */
  COORDINATOR: DurableObjectNamespace;

  ENVIRONMENT?: string;

  /** Vercel deployment (UI + light APIs). */
  VERCEL_ORIGIN: string;
  /** Cloudflare Tunnel to the manually started Colab app. */
  COLAB_ORIGIN: string;
  /** Cloudflare Tunnel to the Kaggle GPU box. */
  GPU_ORIGIN: string;

  /** Cloudflare Access service token used for api./gpu. */
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;

  /** Kaggle API credentials (Basic auth: username + API key). */
  KAGGLE_USERNAME?: string;
  KAGGLE_KEY?: string;

  /** `owner/kernel-slug`; the Worker pushes a new version of this kernel. */
  KAGGLE_KERNEL_REF?: string;
  KAGGLE_KERNEL_TITLE?: string;
  /** `owner/dataset-slug` mounted into the kernel (model weights). */
  KAGGLE_DATASET?: string;
  /** Kaggle machine shape. NvidiaTeslaT4 is Kaggle's 2× T4 shape. */
  KAGGLE_MACHINE_SHAPE?: string;
  KAGGLE_SESSION_TIMEOUT_SECONDS?: string;
  KAGGLE_COOLDOWN_SECONDS?: string;

  /** Raw URL of deploy/kaggle/kelaska-gpu.py in this repository. */
  KERNEL_SOURCE_URL?: string;

  /** Bearer token for the admin endpoints. */
  EDGE_ADMIN_TOKEN?: string;
  /** Shared secret the Kaggle kernel presents on the lease endpoint. */
  GPU_LEASE_KEY?: string;
  /** Idle seconds after which the kernel is told to exit. */
  GPU_IDLE_STOP_SECONDS?: string;
}

export type Upstream = 'vercel' | 'colab' | 'gpu';

export type KaggleStatus = 'idle' | 'starting' | 'online' | 'stopping' | 'offline' | 'error';

export interface CoordinatorState {
  status: KaggleStatus;
  /** True while the Worker wants a GPU box (a generation run asked for one). */
  desired: boolean;
  startedAt: number | null;
  lastHealthAt: number | null;
  lastError: string | null;
  cooldownUntil: number | null;
  failures: number;
  kernelRef: string | null;
  kernelUrl: string | null;
  versionNumber: number | null;
  sessionStatus: string | null;
  stopRequested: boolean;
}

export const EMPTY_COORDINATOR_STATE: CoordinatorState = {
  status: 'idle',
  desired: false,
  startedAt: null,
  lastHealthAt: null,
  lastError: null,
  cooldownUntil: null,
  failures: 0,
  kernelRef: null,
  kernelUrl: null,
  versionNumber: null,
  sessionStatus: null,
  stopRequested: false,
};

/** The queued generation-start body stored in KV while Colab is offline. */
export interface QueuedJob {
  id: string;
  secret: string;
  path: string;
  body: string;
  contentType: string;
  createdAt: number;
  /** Wait for the GPU box as well as Colab before replaying this start. */
  needsGpu: boolean;
}

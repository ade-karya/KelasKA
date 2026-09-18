/**
 * Vercel Blob byte storage for the server asset registry.
 *
 * Each object pathname is exactly its content hash (a `sha256-<hex>` string,
 * URL-safe by construction), mirroring the S3 store's hash-as-key scheme. A
 * crash after PUT and before the registry row is committed leaves an object
 * that reference counting cannot see. Hash-named orphans are harmless and a
 * later write of the same bytes overwrites them idempotently
 * (`allowOverwrite`); no pending-object state is required.
 *
 * Objects are private (`access: 'private'`) and every byte GET is served by
 * the app's own read route (direct egress). There is deliberately no
 * `signReadUrl`: redirects to Blob URLs would bypass the app's ownership
 * check, so a deployment that opts into `ASSET_BYTE_EGRESS` redirect keeps
 * working by degrading to direct bytes (the registry falls back whenever the
 * layer cannot sign).
 */
import type { ContentHash } from './blob.js';
import type { AssetByteStore } from './byte-store.js';

/** Stored bytes are opaque to the object store; the read route relabels them. */
const BLOB_CONTENT_TYPE = 'application/octet-stream';

export interface BlobAssetByteStorePutOptions {
  contentType: string;
}

/**
 * The transport seam, mirroring the S3 store's `commands`/`signer` split: a
 * test double binds this interface, and a deployment that never selects Blob
 * never resolves the real SDK. All three operations address objects by
 * pathname (the content hash); URL handling stays inside the real adapter.
 */
export interface BlobAssetByteStoreClient {
  put(pathname: string, body: Uint8Array, options: BlobAssetByteStorePutOptions): Promise<void>;
  /**
   * Fetch the bytes stored under a pathname, or `null` if there are none.
   * A miss is not an error: only an absent object maps to `null`; anything
   * else throws so an outage can never be mistaken for collected bytes.
   */
  get(pathname: string): Promise<Uint8Array | null>;
  /** Idempotent: deleting an absent object succeeds. */
  del(pathname: string): Promise<void>;
}

export interface BlobAssetByteStoreOptions {
  client: BlobAssetByteStoreClient;
}

const VERCEL_BLOB_PACKAGE = '@vercel/blob';

interface VercelBlobPutResult {
  url: string;
  pathname: string;
}

interface VercelBlobGetResult {
  statusCode: number;
  stream: ReadableStream<Uint8Array> | null;
}

interface VercelBlobSdk {
  put(
    pathname: string,
    body: unknown,
    options: Record<string, unknown>,
  ): Promise<VercelBlobPutResult>;
  get(pathname: string, options: Record<string, unknown>): Promise<VercelBlobGetResult | null>;
  del(pathname: string, options: Record<string, unknown>): Promise<void>;
}

/**
 * Resolve the optional Vercel Blob SDK from this package's resolution scope.
 *
 * The ignored import is deliberate: consumers that do not select Blob neither
 * resolve nor bundle the optional peer dependency. Every caller of this
 * function is therefore reached only from an `await`ed code path, never from
 * module evaluation or a constructor.
 */
async function importBlobSdk(): Promise<VercelBlobSdk> {
  return (await import(/* webpackIgnore: true */ VERCEL_BLOB_PACKAGE)) as VercelBlobSdk;
}

function missingSdk(error: unknown): Error {
  return new Error(
    `@openmaic/storage: the Blob asset byte store requires the optional ${VERCEL_BLOB_PACKAGE} ` +
      'dependency, which could not be resolved. Install it, or construct the store with ' +
      'an explicit `client`.',
    { cause: error },
  );
}

/**
 * Whether an error from the SDK's delete path means *this object* is absent,
 * and nothing else. Deliberately narrow for the same reason as the S3
 * store's `isNotFound`: only object-absent signals map to success; everything
 * else propagates so an outage surfaces as `500 INTERNAL_ERROR` instead of
 * silently dropping bytes the registry still references.
 */
function isBlobNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (candidate.name === 'BlobNotFoundError') return true;
  if (candidate.status === 404 || candidate.statusCode === 404) return true;
  if (typeof candidate.code === 'string' && /not[-_ ]?found/i.test(candidate.code)) return true;
  if (
    typeof candidate.message === 'string' &&
    /not found/i.test(candidate.message) &&
    !/bucket|store/i.test(candidate.message)
  ) {
    return true;
  }
  return false;
}

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.byteLength;
    }
    const out = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Bind the real Vercel Blob SDK behind the transport seam.
 *
 * `token` is passed through to the SDK calls when set; when unset the calls
 * rely on the SDK's own resolution (OIDC on Vercel, `BLOB_READ_WRITE_TOKEN`
 * elsewhere).
 */
export function sdkBlobClient(sdk: VercelBlobSdk, token?: string): BlobAssetByteStoreClient {
  const sdkOptions = token?.trim() ? { token: token.trim() } : {};
  return {
    async put(pathname, body, options) {
      // PutBody has no Uint8Array member; Buffer (an exact copy of the view)
      // is the accepted binary shape on Node.
      await sdk.put(pathname, Buffer.from(body), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: options.contentType,
        ...sdkOptions,
      });
    },
    async get(pathname) {
      const result = await sdk.get(pathname, { ...sdkOptions });
      if (!result || !result.stream) return null;
      return streamToBytes(result.stream);
    },
    async del(pathname) {
      try {
        await sdk.del(pathname, { ...sdkOptions });
      } catch (error) {
        if (isBlobNotFound(error)) return;
        throw error;
      }
    },
  };
}

export interface LoadBlobAssetByteStoreOptions {
  /**
   * Explicit credential for the SDK calls. Unset, the SDK resolves
   * OIDC/`BLOB_READ_WRITE_TOKEN` itself.
   */
  token?: string;
}

/**
 * Build a store bound to the optional Vercel Blob SDK, resolving it now.
 *
 * A host that wants resolution deferred further (or a test double) can
 * construct `new BlobAssetByteStore({ client })` itself instead.
 */
export async function loadBlobAssetByteStore(
  options: LoadBlobAssetByteStoreOptions = {},
): Promise<AssetByteStore> {
  try {
    const sdk = await importBlobSdk();
    return new BlobAssetByteStore({ client: sdkBlobClient(sdk, options.token) });
  } catch (error) {
    throw new Error('@openmaic/storage: Blob asset byte store initialization failed', {
      cause: error,
    });
  }
}

function blobFailure(operation: string): Error {
  return new Error(`@openmaic/storage: Blob asset byte ${operation} failed`);
}

export class BlobAssetByteStore implements AssetByteStore {
  private readonly client: BlobAssetByteStoreClient;
  /**
   * Objects live in the Blob store, never in the registry's own PostgreSQL,
   * so the plain `write` / `read` / `delete` can never contend for the
   * blob-row locks a registry transaction holds. This declaration is what lets
   * the registry run the plain `write` inside its transaction when Blob backs
   * the byte layer (see `AssetByteStore.writesOutsideRegistryDatabase`).
   */
  readonly writesOutsideRegistryDatabase = true as const;

  constructor(options: BlobAssetByteStoreOptions) {
    this.client = options.client;
  }

  async write(hash: ContentHash, bytes: Uint8Array): Promise<void> {
    try {
      await this.client.put(hash, bytes, { contentType: BLOB_CONTENT_TYPE });
    } catch {
      throw blobFailure('write');
    }
  }

  async read(hash: ContentHash): Promise<Uint8Array | null> {
    try {
      return await this.client.get(hash);
    } catch {
      throw blobFailure('read');
    }
  }

  async delete(hash: ContentHash): Promise<void> {
    try {
      await this.client.del(hash);
    } catch {
      throw blobFailure('delete');
    }
  }
}

export type { AssetByteStore } from './byte-store.js';

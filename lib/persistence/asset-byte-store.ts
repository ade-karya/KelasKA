/**
 * Which byte layer the server asset registry stores bytes in.
 *
 * Shared rather than owned by the persistence route, because the offline
 * collector must reclaim through the *same* byte layer the route wrote
 * through. A collector holding a PostgreSQL byte store while the route writes
 * to Blob would drop the blob row and leave the object behind forever, which is
 * the leak the collector exists to close.
 */
import { PgAssetByteStore } from '@openmaic/storage/asset/pg-bytes';
import type { AssetByteStore, Queryable } from '@openmaic/storage/asset/pg';

// Tracing anchors for the standalone build. The store implementations below
// reach their SDKs through deliberately untraced dynamic imports (they
// are optional peers of the storage package), so without a literal reference
// here the shipped image cannot resolve them. The thunks are never called:
// module resolution still happens only on first Blob/S3 use, and the packages
// are server-external, so nothing is bundled either.
const _assetSdkTraceAnchors = {
  client: () => import('@aws-sdk/client-s3'),
  presigner: () => import('@aws-sdk/s3-request-presigner'),
  blob: () => import('@vercel/blob'),
};
void _assetSdkTraceAnchors;

const S3_RESERVED_PREFIXES = ['xn--', 'sthree-', 'amzn-s3-demo-'];
const S3_RESERVED_SUFFIXES = ['-s3alias', '--ol-s3', '.mrap', '--x-s3', '--table-s3'];

/**
 * The no-bucket byte layer widened with the transaction-pinned methods the
 * registry and the collector duck-type on (`writeWith` / `readWith` /
 * `deleteWith`). Without a bucket the layer is statically `PgAssetByteStore`,
 * so the methods are always present; the widening exists so the wrapper's
 * forwarding is type-checked against the real implementations rather than
 * declared by hand.
 */
interface PgForwardedByteStore extends AssetByteStore {
  writeWith: PgAssetByteStore['writeWith'];
  readWith: PgAssetByteStore['readWith'];
  deleteWith: PgAssetByteStore['deleteWith'];
}

/**
 * Whether asset bytes go to Vercel Blob instead of S3/PostgreSQL.
 *
 * Selection is explicit first, automatic second:
 * - `ASSET_STORE=blob` forces Blob; `ASSET_STORE=s3` or `ASSET_STORE=pg`
 *   forces that layer (the S3 branch still needs a valid `ASSET_S3_BUCKET`).
 * - Unset (or any other value, with a warning), the presence of the
 *   Vercel-injected `BLOB_STORE_ID` or a `BLOB_READ_WRITE_TOKEN` opts in:
 *   connecting a Blob store to the project is itself the intent signal, and
 *   it keeps Hobby deployments working with zero extra configuration.
 *
 * Precedence when several layers are configured: Blob > S3 > PostgreSQL, with
 * a warning when Blob wins over an explicitly set `ASSET_S3_BUCKET` so the
 * shadowing is never silent.
 */
export function configuredBlobStore(): boolean {
  const explicit = process.env.ASSET_STORE?.trim().toLowerCase();
  if (explicit === 'blob') return true;
  if (explicit === 's3' || explicit === 'pg' || explicit === 'postgres') return false;
  if (explicit) {
    console.warn(
      `ASSET_STORE=${process.env.ASSET_STORE} is not recognized; using automatic byte-layer selection`,
    );
  }
  return Boolean(process.env.BLOB_STORE_ID?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/**
 * ASSET_S3_BUCKET: a valid bucket name opts asset bytes into S3. The optional
 * AWS SDK owns its standard region, credential, and endpoint configuration;
 * nothing here reads an AWS environment variable itself.
 *
 * Validated eagerly and separately from store construction so a caller can
 * reject a malformed name before it opens a database connection or resolves
 * the optional SDK.
 */
export function configuredS3Bucket(value: string | undefined): string | undefined {
  const bucket = value?.trim();
  if (!bucket) return undefined;
  const invalid =
    bucket.length < 3 ||
    bucket.length > 63 ||
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket) ||
    bucket.includes('..') ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucket) ||
    S3_RESERVED_PREFIXES.some((prefix) => bucket.startsWith(prefix)) ||
    S3_RESERVED_SUFFIXES.some((suffix) => bucket.endsWith(suffix));
  if (invalid) {
    throw new Error(
      'Invalid ASSET_S3_BUCKET: expected a valid Amazon S3 general purpose bucket name',
    );
  }
  return bucket;
}

/**
 * The byte store for the configured layer: Vercel Blob, a configured S3
 * bucket, or the PostgreSQL byte layer.
 *
 * This is the only optional import path. Each storage backend owns its SDK
 * dependency and its ignored native import, so resolution happens from the
 * package that declares the peer rather than from this app — and only when
 * that backend is actually selected.
 */
export async function createAssetByteStore(
  bucket: string | undefined,
  queryable: Queryable,
): Promise<AssetByteStore> {
  if (configuredBlobStore()) {
    if (bucket) {
      console.warn(
        'Both Vercel Blob and ASSET_S3_BUCKET are configured; Blob takes precedence and the S3 bucket is ignored. ' +
          'Set ASSET_STORE=s3 to use S3, or unset the Blob variables to silence this warning.',
      );
    }
    const storage = await import('@openmaic/storage/asset/blob-bytes');
    return storage.loadBlobAssetByteStore();
  }
  if (!bucket) return new PgAssetByteStore(queryable);
  const storage = await import('@openmaic/storage/asset/s3-bytes');
  return storage.loadS3AssetByteStore(bucket);
}

/**
 * A byte store whose construction is deferred to first use.
 *
 * The asset backend is optional, so its configuration must not gate the rest
 * of persistence. Awaiting createAssetByteStore during handler initialization
 * would let an invalid ASSET_S3_BUCKET, or an AWS/Blob SDK that cannot be
 * resolved, reject the shared handler and take document and runtime traffic
 * down with it. With this wrapper, installed instead, handler initialization never
 * touches asset configuration: a misconfiguration fails asset requests and
 * only asset requests. A failed construction is not cached, so the next asset
 * request retries — the same no-poisoned-singleton rule the route applies to
 * its own initialization.
 */
export function lazyAssetByteStore(
  bucketValue: string | undefined,
  queryable: Queryable,
): AssetByteStore {
  let pending: Promise<AssetByteStore> | undefined;
  const resolve = (): Promise<AssetByteStore> =>
    (pending ??= createAssetByteStore(configuredS3Bucket(bucketValue), queryable).catch(
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    ));
  const base = {
    write: async (hash, bytes) => (await resolve()).write(hash, bytes),
    read: async (hash) => (await resolve()).read(hash),
    delete: async (hash) => (await resolve()).delete(hash),
  } satisfies AssetByteStore;
  // The PostgreSQL byte column can never sign, and advertising the method
  // anyway would make resolveIndirect take its ownership query and blob-row
  // lock before declining, then repeat them in resolve -- on every cold GET.
  // With no bucket configured the layer is known now, so the method is
  // simply absent. With a bucket (or Blob), lazy validation is preserved: the
  // wrapper answers `undefined` when the resolved layer turns out not to sign
  // (Blob objects are private and always served through the read route).
  if (!bucketValue?.trim() && !configuredBlobStore()) {
    // No bucket means the layer is statically PgAssetByteStore, whose bytes
    // live in the registry's own PostgreSQL. Its transaction-pinned
    // writeWith/readWith/deleteWith MUST be forwarded: without them the
    // registry's coordinatedWrite duck-type check fails and it falls back to
    // the plain write on the byte store's own pooled connection, which blocks
    // forever on the blob-row lock the registry transaction just took -- the
    // self-deadlock. The layer is known now, so the methods are always
    // present; nothing here is probed lazily.
    const forwarded: PgForwardedByteStore = {
      ...base,
      writeWith: async (queryable, hash, bytes) =>
        ((await resolve()) as PgAssetByteStore).writeWith(queryable, hash, bytes),
      readWith: async (queryable, hash) =>
        ((await resolve()) as PgAssetByteStore).readWith(queryable, hash),
      deleteWith: async (queryable, hash) =>
        ((await resolve()) as PgAssetByteStore).deleteWith(queryable, hash),
    };
    return forwarded;
  }
  return {
    ...base,
    // S3 and Blob objects never live in the registry's database, so the
    // registry may run the plain write inside its transaction (see
    // AssetByteStore.writesOutsideRegistryDatabase). Neither has a
    // transactional writer, so nothing is forwarded here, exactly as before.
    writesOutsideRegistryDatabase: true as const,
    signReadUrl: async (hash, headers) => {
      const store = await resolve();
      return typeof store.signReadUrl === 'function' ? store.signReadUrl(hash, headers) : undefined;
    },
  };
}

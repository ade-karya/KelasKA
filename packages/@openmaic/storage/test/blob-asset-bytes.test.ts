import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContentHash } from '../src/asset/blob.js';
import {
  BlobAssetByteStore,
  sdkBlobClient,
  type BlobAssetByteStoreClient,
} from '../src/asset/blob-bytes.js';

function hash(value: string): ContentHash {
  return `sha256-${value}` as ContentHash;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function streamOf(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Split across two chunks so the tests exercise multi-chunk assembly.
      const mid = Math.ceil(data.byteLength / 2);
      controller.enqueue(data.slice(0, mid));
      controller.enqueue(data.slice(mid));
      controller.close();
    },
  });
}

/** In-memory transport double behind the client seam. */
class MemoryBlobClient implements BlobAssetByteStoreClient {
  readonly objects = new Map<string, Uint8Array>();

  async put(pathname: string, body: Uint8Array): Promise<void> {
    this.objects.set(pathname, Uint8Array.from(body));
  }

  async get(pathname: string): Promise<Uint8Array | null> {
    const found = this.objects.get(pathname);
    return found ? Uint8Array.from(found) : null;
  }

  async del(pathname: string): Promise<void> {
    this.objects.delete(pathname);
  }
}

describe('BlobAssetByteStore byte operations', () => {
  it('round-trips bytes written under a hash', async () => {
    const store = new BlobAssetByteStore({ client: new MemoryBlobClient() });
    await store.write(hash('abc'), bytes('hello blob'));
    expect(await store.read(hash('abc'))).toEqual(bytes('hello blob'));
  });

  it('writes idempotently: overwriting the same hash succeeds', async () => {
    const client = new MemoryBlobClient();
    const store = new BlobAssetByteStore({ client });
    await store.write(hash('abc'), bytes('one'));
    await store.write(hash('abc'), bytes('two'));
    expect(await store.read(hash('abc'))).toEqual(bytes('two'));
    expect(client.objects.size).toBe(1);
  });

  it('reads a missing hash as null', async () => {
    const store = new BlobAssetByteStore({ client: new MemoryBlobClient() });
    expect(await store.read(hash('missing'))).toBeNull();
  });

  it('surfaces transport failures instead of inventing a miss', async () => {
    const failing: BlobAssetByteStoreClient = {
      put: () => Promise.reject(new Error('boom')),
      get: () => Promise.reject(new Error('boom')),
      del: () => Promise.reject(new Error('boom')),
    };
    const store = new BlobAssetByteStore({ client: failing });
    await expect(store.write(hash('abc'), bytes('x'))).rejects.toThrow(
      /Blob asset byte write failed/,
    );
    await expect(store.read(hash('abc'))).rejects.toThrow(/Blob asset byte read failed/);
    await expect(store.delete(hash('abc'))).rejects.toThrow(/Blob asset byte delete failed/);
  });

  it('deletes bytes and stays idempotent on a second delete', async () => {
    const store = new BlobAssetByteStore({ client: new MemoryBlobClient() });
    await store.write(hash('abc'), bytes('x'));
    await store.delete(hash('abc'));
    expect(await store.read(hash('abc'))).toBeNull();
    await expect(store.delete(hash('abc'))).resolves.toBeUndefined();
  });

  it('declares bytes outside the registry database and never signs', () => {
    const store = new BlobAssetByteStore({ client: new MemoryBlobClient() });
    expect(store.writesOutsideRegistryDatabase).toBe(true);
    expect('signReadUrl' in store).toBe(false);
  });
});

describe('sdkBlobClient adapter', () => {
  it('puts private objects without a random suffix and allows overwrite', async () => {
    const sdk = { put: vi.fn().mockResolvedValue({}), get: vi.fn(), del: vi.fn() };
    const client = sdkBlobClient(sdk, 'token');
    await client.put('sha256-abc', bytes('x'), { contentType: 'application/octet-stream' });
    expect(sdk.put).toHaveBeenCalledTimes(1);
    const [pathname, body, options] = sdk.put.mock.calls[0] as [
      string,
      unknown,
      Record<string, unknown>,
    ];
    expect(pathname).toBe('sha256-abc');
    expect(Buffer.from(body as Uint8Array).toString()).toBe('x');
    expect(options).toMatchObject({
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/octet-stream',
      token: 'token',
    });
  });

  it('assembles multi-chunk get streams and maps a miss to null', async () => {
    const sdk = {
      put: vi.fn(),
      get: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ statusCode: 200, stream: streamOf(bytes('fetched')) }),
      del: vi.fn(),
    };
    const client = sdkBlobClient(sdk);
    expect(await client.get('sha256-missing')).toBeNull();
    expect(await client.get('sha256-abc')).toEqual(bytes('fetched'));
    expect(sdk.get).toHaveBeenCalledWith('sha256-abc', {});
  });

  it('treats object-absent delete errors as success', async () => {
    for (const absent of [
      { status: 404 },
      { statusCode: 404 },
      { name: 'BlobNotFoundError' },
      Object.assign(new Error('Blob not found'), { code: 'BlobNotFound' }),
    ]) {
      const sdk = { put: vi.fn(), get: vi.fn(), del: vi.fn().mockRejectedValue(absent) };
      const client = sdkBlobClient(sdk, 'token');
      await expect(client.del('sha256-abc')).resolves.toBeUndefined();
    }
  });

  it('rethrows non-absent delete errors', async () => {
    const sdk = {
      put: vi.fn(),
      get: vi.fn(),
      del: vi.fn().mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 })),
    };
    const client = sdkBlobClient(sdk, 'token');
    await expect(client.del('sha256-abc')).rejects.toThrow('forbidden');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

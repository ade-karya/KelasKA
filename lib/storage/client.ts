/**
 * Upload a single blob to object storage and return its CDN URL.
 *
 * The upstream hosted deployment serves `/api/storage/upload` (content-hash
 * deduplication, returns a public URL). Neither this fork nor a self-hosted
 * upstream ships that route, so every call was a guaranteed 404 and callers
 * silently fell back to inline data URLs. This fork keeps the documented
 * graceful-degradation contract — callers must handle `null` — without the
 * wasted round-trip. Restore the fetch together with a real
 * `/api/storage/upload` implementation.
 *
 * The signature is kept so existing callers (PBL v2 submissions) do not change.
 */
export async function uploadBlobToStorage(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  blob?: Blob,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type?: 'media' | 'audio' | 'poster',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  signal?: AbortSignal,
): Promise<string | null> {
  return null;
}

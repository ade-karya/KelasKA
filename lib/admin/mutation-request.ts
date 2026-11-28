/**
 * Request options for the admin console's API mutations.
 *
 * The server's `isSameOriginJsonRequest` guard requires
 * `Content-Type: application/json` on PATCH/POST/DELETE. A bodyless DELETE
 * must still send an empty JSON object, otherwise the guard answers FORBIDDEN
 * and the UI shows "Hanya admin yang dapat mengelola pengguna" even for an
 * authenticated admin.
 */
export function adminMutationInit(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): RequestInit {
  if (method === 'GET') return { method, cache: 'no-store' };
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  };
}

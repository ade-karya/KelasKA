/**
 * Deep-link id resolution for statically exported routes on Vercel.
 *
 * `vercel.json` rewrites `/classroom/<id>` to `/classroom?id=<id>` (and the
 * same for `/project-workspace`). A Vercel `routes` rewrite is internal: the
 * browser's address bar — and therefore `useSearchParams()` after hydration —
 * still shows the path form, with no `id` in the query. A page that reads only
 * the query reports "not found" for a course that does exist (the link the
 * full app emits after generation is `/classroom/<id>`).
 *
 * Read both shapes: the query wins, and the single segment after the route is
 * the fallback. The same helper builds the login `next` so other query
 * parameters (e.g. `?scene=` in exported decks) survive the auth round trip.
 */

export type RouteParams = Pick<URLSearchParams, 'get' | 'toString'>;

export function staticRouteId(
  params: RouteParams,
  pathname: string,
  route: string,
  keys: readonly string[] = ['id'],
): string | null {
  for (const key of keys) {
    const fromQuery = params.get(key);
    if (fromQuery) return fromQuery;
  }

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length !== 2 || segments[0] !== route) return null;
  try {
    const fromPath = decodeURIComponent(segments[1]);
    return fromPath.length > 0 ? fromPath : null;
  } catch {
    // A malformed escape is not an id.
    return null;
  }
}

/** Canonical query-form URL used for the login round trip. */
export function staticRouteLoginNext(
  params: RouteParams,
  route: string,
  id: string,
  keys: readonly string[] = ['id'],
): string {
  const next = new URLSearchParams(params.toString());
  for (const key of keys) next.delete(key);
  next.set('id', id);
  return `/${route}?${next.toString()}`;
}

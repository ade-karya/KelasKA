import { getAuthenticatedOwnerId } from '@/lib/server/auth/session';

import { resolveRequestOwnerId } from './owner';

/**
 * Whether the username+password login is required. Reads the env directly
 * instead of `isUserAuthEnabled()` from feature-flags on purpose: this choke
 * point is imported by every agent route (whose tests mock feature-flags
 * partially), and the predicate is a trivial env check. It mirrors
 * `isUserAuthEnabled()` — both are true exactly when USER_AUTH_ENABLED is
 * "true" or "1". Keep them in sync.
 */
function isLoginRequired(): boolean {
  const value = process.env.USER_AUTH_ENABLED?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Resolve the request owner identity and run a handler with its response
 * headers.
 *
 * The Set-Cookie minted by resolveRequestOwnerId must ride every response,
 * including 4xx and 5xx: a client that retries after an error keeps the same
 * owner partition, while a 500 that dropped the cookie would silently make
 * the retry a different anonymous owner.
 *
 * Fail-closed when the username+password login is enabled
 * (`USER_AUTH_ENABLED=true`): requests without a valid session never reach
 * the handler as an anonymous owner — they get 401 here.
 */
export async function withRequestOwnerId(
  req: Pick<Request, 'headers'>,
  handler: (ownerId: string, responseHeaders: Headers) => Promise<Response>,
): Promise<Response> {
  const resolved = await requireRequestOwnerId(req);
  if (resolved.ownerId === null) return resolved.response;
  try {
    return await handler(resolved.ownerId, resolved.responseHeaders);
  } catch (error) {
    console.error('[agent-runtime] request failed for owner', error);
    return new Response('Internal Server Error', {
      status: 500,
      headers: resolved.responseHeaders,
    });
  }
}

function unauthenticatedResponse(responseHeaders: Headers): Response {
  return new Response(
    JSON.stringify({
      success: false as const,
      errorCode: 'UNAUTHENTICATED',
      error: 'Authentication required',
    }),
    {
      status: 401,
      headers: { ...Object.fromEntries(responseHeaders), 'Content-Type': 'application/json' },
    },
  );
}

/**
 * Direct-route variant of the fail-closed gate above, for the SSE routes that
 * resolve the owner inline instead of going through `withRequestOwnerId`
 * (owner-events, session events, stage freshness). Returns either the owner
 * plus its headers, or a ready-to-return 401.
 */
export async function requireRequestOwnerId(
  req: Pick<Request, 'headers'>,
): Promise<
  | { ownerId: string; responseHeaders: Headers; response?: undefined }
  | { ownerId: null; responseHeaders: Headers; response: Response }
> {
  const responseHeaders = new Headers();
  const authenticatedOwnerId = await getAuthenticatedOwnerId(req);
  if (isLoginRequired() && !authenticatedOwnerId) {
    return { ownerId: null, responseHeaders, response: unauthenticatedResponse(responseHeaders) };
  }
  const ownerId = resolveRequestOwnerId(req, responseHeaders, authenticatedOwnerId ?? undefined);
  return { ownerId, responseHeaders };
}

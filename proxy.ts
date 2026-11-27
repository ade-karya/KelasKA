import { NextRequest, NextResponse } from 'next/server';

import { isAgentRuntimeConfigured, isWorkbenchEnabled } from '@/lib/config/feature-flags';
import { verifyAccessTokenEdge } from '@/lib/server/access-token-edge';
import { cookiesAreSecure } from '@/lib/server/cookie-secure';
import { AUTH_COOKIE, authEnabled, authPublicBaseUrl, authSecret } from '@/lib/server/auth/config';
import { verifySessionToken } from '@/lib/server/auth/session-token';
import {
  anonymousOwnerForNavigation,
  type NavigationIdentity,
} from '@/lib/server/identity/navigation';

/**
 * Let the request through, carrying the anonymous owner a page request
 * establishes: the cookie is set on the page response, and the forwarded
 * request carries it too, so the page and every request it sends resolve one
 * owner (see `lib/server/identity/navigation.ts`).
 */
function next(request: NextRequest, identity: NavigationIdentity | undefined): NextResponse {
  if (!identity) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set('cookie', identity.requestCookie);
  const response = NextResponse.next({ request: { headers } });
  response.headers.append('set-cookie', identity.setCookie);
  return response;
}

/** Routes reachable while signed out: the login page and the authentication API. */
function isAuthPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/api/health' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/access-code/')
  );
}

function clearAuthCookieHeader(): string {
  const secure = cookiesAreSecure() ? '; Secure' : '';
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function loginRedirect(request: NextRequest, pathname: string): NextResponse {
  // Behind a proxy the request origin is the internal listen address; an
  // operator-set AUTH_PUBLIC_URL pins the public one for this redirect.
  const target = new URL('/login', authPublicBaseUrl() ?? request.url);
  if (pathname !== '/') target.searchParams.set('next', pathname + request.nextUrl.search);
  return NextResponse.redirect(target);
}

/**
 * The account gate. With `AUTH_ENABLED` on, every page and every API route
 * except the login surface needs a session whose signature and expiry check
 * out. The proxy only proves *authentication*: the role lives in the database
 * (so it is current) and the pages apply it, which keeps a promoted account
 * from being routed by a stale cookie.
 *
 * A token that is present but invalid is cleared on the way out, so a stale
 * cookie cannot bounce a browser between `/login` and the page it asked for.
 */
async function enforceAuth(request: NextRequest): Promise<NextResponse | undefined> {
  if (!authEnabled()) return undefined;

  const { pathname } = request.nextUrl;
  const secret = authSecret();
  if (!secret) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        {
          success: false,
          errorCode: 'INTERNAL_ERROR',
          error: 'Authentication is enabled but AUTH_SECRET/OPENMAIC_SECRET_KEY is not set',
        },
        { status: 503 },
      );
    }
    return new NextResponse('Authentication is misconfigured: set AUTH_SECRET.', { status: 503 });
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const payload = token ? await verifySessionToken(token, secret) : null;
  if (payload) {
    // The signature only proves this deployment minted the cookie; whether the
    // session row still exists is a database question the Edge runtime cannot
    // answer. So `/login` is NOT redirected from here: a revoked or expired
    // session (deactivated account, revoked row, pruned row) would bounce
    // `/login` → `/` → `/login` forever. The login page reads the
    // account itself and sends a live session to its role's home.
    return undefined;
  }

  if (isAuthPublicPath(pathname)) return undefined;

  if (pathname.startsWith('/api/')) {
    const response = NextResponse.json(
      { success: false, errorCode: 'UNAUTHENTICATED', error: 'Login required' },
      { status: 401 },
    );
    if (token) response.headers.append('set-cookie', clearAuthCookieHeader());
    return response;
  }

  const response = loginRedirect(request, pathname);
  if (token) response.headers.append('set-cookie', clearAuthCookieHeader());
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The Kaggle app is published on a tunnel, but only the Vercel project's
  // external rewrite may call it: that route injects this shared secret, and
  // anything arriving without it is refused before a page or API runs. Unset
  // keeps the historical behaviour for a direct/self-hosted deployment.
  const proxyToken = process.env.KELASKA_PROXY_TOKEN?.trim();
  if (proxyToken && pathname !== '/api/health') {
    if (request.headers.get('x-kelaska-proxy-token') !== proxyToken) {
      return new NextResponse('Not found', { status: 404 });
    }
  }

  // This machine-only route verifies its own signed gateway request in Node.
  if (pathname === '/api/sandbox/preview/resolve') return NextResponse.next();

  // Accounts, when this deployment has them: signed-out browsers go to the
  // login page and signed-out API calls answer 401 before any handler runs.
  const authResponse = await enforceAuth(request);
  if (authResponse) return authResponse;

  // Return an actual server-side 404 when either half of the workbench is off.
  // Edge proxy cannot reliably inspect server-only deployment variables,
  // so it enforces the public gate and leaves the complete runtime/database
  // check to Node. A Node-hosted proxy uses the same gate as startup.
  const canInspectServerRuntime = process.env.NEXT_RUNTIME !== 'edge';
  const workbenchEnabled =
    isWorkbenchEnabled() && (!canInspectServerRuntime || isAgentRuntimeConfigured());
  if (!workbenchEnabled && (pathname === '/workbench' || pathname.startsWith('/workbench/'))) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Accounts are the identity: no anonymous cookie is minted for them, and a
  // valid session already proves more than the shared access code does.
  if (authEnabled()) return next(request, undefined);

  // One anonymous owner per browser, established on the page response before
  // any API request can mint its own.
  const identity = anonymousOwnerForNavigation({
    method: request.method,
    headers: request.headers,
    pathname,
  });

  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) {
    return next(request, identity);
  }

  // Whitelist: access-code endpoints, health check
  if (pathname.startsWith('/api/access-code/') || pathname === '/api/health') {
    return next(request, identity);
  }

  // Check cookie — validate HMAC signature, not just existence
  const cookie = request.cookies.get('openmaic_access');
  if (cookie?.value && (await verifyAccessTokenEdge(cookie.value, accessCode))) {
    return next(request, identity);
  }

  // API requests without valid cookie → 401
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
      { status: 401 },
    );
  }

  // Page requests → let through, frontend shows modal
  return next(request, identity);
}

export const config = {
  // Keep `/api/*` covered (access-code 401 lives in proxy). Exclude Next
  // internals, metadata files and public static assets so they don't pay
  // for anonymous-owner + 200MB body buffering on every image/font/JSON hit.
  // The duplex machine route authenticates its signed descriptor itself.
  // Middleware forwarding buffers POST bodies and would deadlock a
  // bidirectional stream, so it stays excluded from the matcher entirely.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|favicon.png|apple-icon.png|sitemap.xml|robots.txt|logos|avatars|docs|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.svg$|.*\\.webp$|.*\\.avif$|.*\\.ico$|.*\\.txt$|.*\\.xml$|.*\\.json$|.*\\.webmanifest$|api/sandbox/preview/tunnel$).*)',
  ],
};

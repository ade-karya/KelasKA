import { NextRequest, NextResponse } from 'next/server';

import {
  isAgentRuntimeConfigured,
  isProWorkbenchEnabled,
  isUserAuthEnabled,
} from '@/lib/config/feature-flags';
import { verifyAccessTokenEdge } from '@/lib/server/access-token-edge';

// Edge-safe duplicate of SESSION_COOKIE from lib/server/auth/session.ts.
// session.ts uses node:crypto and must not be imported in Edge middleware.
const USER_SESSION_COOKIE = 'openmaic_session';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Return an actual server-side 404 when either half of the workbench is off.
  // Edge middleware cannot reliably inspect server-only deployment variables,
  // so it enforces the public gate and leaves the complete runtime/database
  // check to Node. A Node-hosted middleware uses the same gate as startup.
  const canInspectServerRuntime = process.env.NEXT_RUNTIME !== 'edge';
  const workbenchEnabled =
    isProWorkbenchEnabled() && (!canInspectServerRuntime || isAgentRuntimeConfigured());
  if (!workbenchEnabled && (pathname === '/workbench' || pathname.startsWith('/workbench/'))) {
    return new NextResponse('Not found', { status: 404 });
  }

  const accessCode = process.env.ACCESS_CODE;
  if (accessCode) {
    // Whitelist: access-code endpoints, health check
    const isAccessWhitelisted =
      pathname.startsWith('/api/access-code/') || pathname === '/api/health';
    if (!isAccessWhitelisted) {
      // Check cookie — validate HMAC signature, not just existence
      const cookie = request.cookies.get('openmaic_access');
      if (cookie?.value && (await verifyAccessTokenEdge(cookie.value, accessCode))) {
        // Valid access cookie: fall through to the user-auth gate below.
      } else if (pathname.startsWith('/api/')) {
        // API requests without valid cookie → 401
        return NextResponse.json(
          { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
          { status: 401 },
        );
      } else {
        // Page requests → let through, frontend shows modal
        return NextResponse.next();
      }
    }
  }

  // Username+password gate. Edge middleware cannot do the DB-backed session
  // lookup, so it enforces presence only; routes validate expiry/ownership via
  // getAuthenticatedOwnerId(). Pages are let through — the frontend redirects
  // to /login on API 401 (full global guard is a follow-up, see app/login).
  if (isUserAuthEnabled()) {
    if (
      pathname.startsWith('/api/auth/') ||
      pathname.startsWith('/api/access-code/') ||
      pathname === '/api/health'
    ) {
      return NextResponse.next();
    }
    if (pathname.startsWith('/api/')) {
      const sessionCookie = request.cookies.get(USER_SESSION_COOKIE)?.value;
      if (!sessionCookie) {
        return NextResponse.json(
          { success: false, errorCode: 'UNAUTHENTICATED', error: 'Authentication required' },
          { status: 401 },
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};

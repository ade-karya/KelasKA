/**
 * Next.js Proxy — PIN-based auth guard
 *
 * Protects API routes: without a valid PIN session cookie,
 * API calls (except /api/auth/pin) return 401.
 * Page routes are allowed through (the client-side AuthGuard handles UI).
 */

import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_API_PATHS = ['/api/auth/pin', '/api/health'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only guard /api routes (except public ones)
  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Allow public API paths
  if (PUBLIC_API_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check for PIN session cookie
  const token = req.cookies.get('pin_session')?.value;
  if (!token) {
    return NextResponse.json(
      { success: false, errorCode: 'UNAUTHORIZED', error: 'Authentication required' },
      { status: 401 },
    );
  }

  // Token format validation (basic check — full HMAC check happens in route handlers)
  const parts = token.split(':');
  if (parts.length < 4) {
    const response = NextResponse.json(
      { success: false, errorCode: 'UNAUTHORIZED', error: 'Invalid session' },
      { status: 401 },
    );
    response.cookies.delete('pin_session');
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};

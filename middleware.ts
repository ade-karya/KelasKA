import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const isLoggedIn = request.cookies.has('auth_session');
  const isLoginPage = request.nextUrl.pathname === '/login';

  // Allow next static files, images, etc.
  if (
    request.nextUrl.pathname.startsWith('/_next') ||
    request.nextUrl.pathname.startsWith('/assets') ||
    request.nextUrl.pathname.startsWith('/api') ||
    request.nextUrl.pathname.startsWith('/robots.txt') ||
    request.nextUrl.pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  if (!isLoggedIn && !isLoginPage) {
    // Redirect to login if unauthenticated and not already on the login page
    return NextResponse.redirect(new URL('/login', request.url));
  }
  
  if (isLoggedIn && isLoginPage) {
    // Redirect to home if already logged in and trying to access the login page
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Apply middleware to all routes except standard static assets
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

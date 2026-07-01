import { NextResponse } from 'next/server';
import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
import { verifyAdminToken, ADMIN_COOKIE_NAME } from '@/lib/admin/admin-auth';

const { auth } = NextAuth(authConfig);

/** Convert string to Uint8Array */
function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** Convert ArrayBuffer to hex string */
function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify an HMAC-signed token using Web Crypto API (Edge-compatible) */
async function verifyToken(token: string, accessCode: string): Promise<boolean> {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  const keyData = encode(accessCode);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const data = encode(timestamp);
  const expected = bufToHex(await crypto.subtle.sign('HMAC', key, data.buffer as ArrayBuffer));

  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export default auth(async function proxy(request) {
  const { pathname } = request.nextUrl;
  const isLoggedIn = !!request.auth?.user;

  // --- NextAuth Protection ---
  const isOnDashboard = pathname.startsWith('/dashboard') || pathname.startsWith('/classroom');
  const isOnAuth = pathname.startsWith('/login') || pathname.startsWith('/register');

  if (isOnDashboard && !isLoggedIn) {
    return NextResponse.redirect(new URL('/login', request.nextUrl));
  }

  if (isOnAuth && isLoggedIn) {
    return NextResponse.redirect(new URL('/dashboard', request.nextUrl));
  }
  // --- End NextAuth Protection ---

  // --- Admin Route Protection ---
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    if (pathname === '/admin/login' || pathname === '/api/admin/auth/login') {
      return NextResponse.next();
    }

    const adminCookie = request.cookies.get(ADMIN_COOKIE_NAME);
    const isValidAdmin = adminCookie?.value ? await verifyAdminToken(adminCookie.value) : false;

    if (!isValidAdmin) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { success: false, errorCode: 'UNAUTHORIZED', error: 'Admin access required' },
          { status: 401 },
        );
      }
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
    return NextResponse.next();
  }
  // --- End Admin Route Protection ---

  // --- Access Code Protection (Optional, if set in env) ---
  const accessCode = process.env.ACCESS_CODE;
  if (!accessCode) {
    return NextResponse.next();
  }

  // Whitelist: access-code endpoints, health check, login/register, nextauth endpoints
  if (
    pathname.startsWith('/api/access-code/') || 
    pathname === '/api/health' ||
    pathname.startsWith('/api/auth/') ||
    pathname === '/login' ||
    pathname === '/register'
  ) {
    return NextResponse.next();
  }

  // Check cookie — validate HMAC signature
  const cookie = request.cookies.get('openmaic_access');
  if (cookie?.value && (await verifyToken(cookie.value, accessCode))) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { success: false, errorCode: 'INVALID_REQUEST', error: 'Access code required' },
      { status: 401 },
    );
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logos/).*)'],
};

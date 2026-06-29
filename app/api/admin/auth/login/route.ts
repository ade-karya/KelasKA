import { NextResponse } from 'next/server';
import { verifyAdminPassword, generateAdminToken, ADMIN_COOKIE_NAME } from '@/lib/admin/admin-auth';

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    
    if (!password || !verifyAdminPassword(password)) {
      return NextResponse.json({ success: false, error: 'Invalid password' }, { status: 401 });
    }

    const token = await generateAdminToken();
    const response = NextResponse.json({ success: true });
    
    // Cookie is accessible across all paths, HttpOnly for security, secure if not on localhost
    const isProduction = process.env.NODE_ENV === 'production';
    
    response.cookies.set({
      name: ADMIN_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (err) {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

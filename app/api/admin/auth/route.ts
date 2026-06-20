import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword) {
      return NextResponse.json(
        { error: 'Admin password not configured on server' },
        { status: 500 }
      );
    }

    if (password !== adminPassword) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // Set a simple HTTP-only cookie for session
    const response = NextResponse.json({ success: true });
    response.cookies.set('admin_session', adminPassword, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

/** Check if current session is authenticated */
export async function GET(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const sessionCookie = request.cookies.get('admin_session')?.value;

  if (!adminPassword) {
    return NextResponse.json({ authenticated: false, error: 'Not configured' });
  }

  return NextResponse.json({
    authenticated: sessionCookie === adminPassword,
  });
}

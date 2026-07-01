import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';

// GET /api/auth/me — Return current authenticated user info with tenants
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum masuk' }, { status: 401 });
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      tenants: user.tenants,
    });
  } catch (error) {
    console.error('Auth me error:', error);
    return NextResponse.json({ error: 'Kesalahan server' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/session';

// POST /api/notifications/register-device — Register FCM device token for push notifications
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum masuk' }, { status: 401 });
    }

    const { token } = await req.json();

    if (!token) {
      return NextResponse.json({ error: 'Token wajib diisi' }, { status: 400 });
    }

    // In a production setup, we store the FCM token in a UserDevice table to target pushes.
    // For now, we update the user's bio/profile metadata or log the registration.
    console.log(`FCM Token registered for user ${user.email}: ${token}`);

    return NextResponse.json({ success: true, message: 'Token berhasil didaftarkan' });
  } catch (error) {
    console.error('Register device token error:', error);
    return NextResponse.json({ error: 'Kesalahan server' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/session';

// GET /api/notifications — Retrieve notifications for current user
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum masuk' }, { status: 401 });
    }

    const notifications = await db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50, // limit to latest 50 notifications
    });

    const unreadCount = await db.notification.count({
      where: { userId: user.id, isRead: false },
    });

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    console.error('List notifications error:', error);
    return NextResponse.json({ error: 'Kesalahan server' }, { status: 500 });
  }
}

// PUT /api/notifications — Mark all notifications as read
export async function PUT() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum masuk' }, { status: 401 });
    }

    await db.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update notifications error:', error);
    return NextResponse.json({ error: 'Kesalahan server' }, { status: 500 });
  }
}

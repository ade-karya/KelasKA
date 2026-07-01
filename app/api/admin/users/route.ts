import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/session';

// GET /api/admin/users — List all users with their tenant roles
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Belum masuk' }, { status: 401 });

    const isSuperAdmin = user.tenants.some((t) => t.role === 'SUPER_ADMIN');
    if (!isSuperAdmin) return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || undefined;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = 20;

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          tenants: {
            include: { tenant: { select: { name: true, plan: true } } },
          },
        },
      }),
      db.user.count({ where }),
    ]);

    return NextResponse.json({
      users,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Admin users error:', error);
    return NextResponse.json({ error: 'Kesalahan server' }, { status: 500 });
  }
}

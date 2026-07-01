import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/session';

// GET /api/discussions/[id] — Get discussion and its replies
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const discussion = await db.discussion.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        replies: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatar: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!discussion) {
      return NextResponse.json({ error: 'Diskusi tidak ditemukan' }, { status: 404 });
    }

    return NextResponse.json({ discussion });
  } catch (error) {
    console.error('Get discussion error:', error);
    return NextResponse.json({ error: 'Kesalahan server' }, { status: 500 });
  }
}

// POST /api/discussions/[id] — Add a reply
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: discussionId } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum masuk' }, { status: 401 });
    }

    const { content } = await req.json();

    if (!content) {
      return NextResponse.json({ error: 'Konten reply wajib diisi' }, { status: 400 });
    }

    const discussion = await db.discussion.findUnique({
      where: { id: discussionId },
      select: { courseId: true },
    });

    if (!discussion) {
      return NextResponse.json({ error: 'Diskusi tidak ditemukan' }, { status: 404 });
    }

    // Verify enrollment or instructor status
    const enrollment = await db.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: discussion.courseId } },
    });

    const isInstructor = user.tenants.some((t) => t.role === 'INSTRUCTOR' || t.role === 'ADMIN');
    
    if (!enrollment && !isInstructor) {
      return NextResponse.json({ error: 'Tidak berwenang' }, { status: 403 });
    }

    const reply = await db.reply.create({
      data: {
        discussionId,
        userId: user.id,
        content,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    return NextResponse.json({ reply }, { status: 201 });
  } catch (error) {
    console.error('Create reply error:', error);
    return NextResponse.json({ error: 'Kesalahan server' }, { status: 500 });
  }
}

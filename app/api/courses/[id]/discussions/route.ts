import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/session';

// GET /api/courses/[id]/discussions — Get discussion threads for a course
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: courseId } = await params;

    const discussions = await db.discussion.findMany({
      where: { courseId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        _count: { select: { replies: true } },
      },
      orderBy: [
        { isPinned: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return NextResponse.json({ discussions });
  } catch (error) {
    console.error('List discussions error:', error);
    return NextResponse.json({ error: 'Kesalahan server' }, { status: 500 });
  }
}

// POST /api/courses/[id]/discussions — Create a discussion thread
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: courseId } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum masuk' }, { status: 401 });
    }

    // Verify enrollment
    const enrollment = await db.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId } },
    });

    const isInstructor = user.tenants.some((t) => t.role === 'INSTRUCTOR' || t.role === 'ADMIN');
    
    if (!enrollment && !isInstructor) {
      return NextResponse.json({ error: 'Anda harus terdaftar di kursus ini untuk berdiskusi' }, { status: 403 });
    }

    const { title, content } = await req.json();

    if (!title || !content) {
      return NextResponse.json({ error: 'Judul dan konten wajib diisi' }, { status: 400 });
    }

    const discussion = await db.discussion.create({
      data: {
        courseId,
        userId: user.id,
        title,
        content,
      },
    });

    return NextResponse.json({ discussion }, { status: 201 });
  } catch (error) {
    console.error('Create discussion error:', error);
    return NextResponse.json({ error: 'Kesalahan server' }, { status: 500 });
  }
}

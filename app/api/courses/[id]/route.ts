import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";

// GET /api/courses/[id] — Get single course with lessons
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();

    const course = await db.course.findUnique({
      where: { id },
      include: {
        lessons: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            title: true,
            description: true,
            order: true,
            duration: true,
            isFree: true,
            classroomId: true,
            createdAt: true,
          },
        },
        _count: { select: { enrollments: true } },
      },
    });

    if (!course) {
      return NextResponse.json({ error: "Kursus tidak ditemukan" }, { status: 404 });
    }

    // Check if user is enrolled
    let enrollment = null;
    if (user) {
      enrollment = await db.enrollment.findUnique({
        where: {
          userId_courseId: {
            userId: user.id,
            courseId: id,
          },
        },
      });
    }

    // Get progress if enrolled
    let progress: any[] = [];
    if (enrollment) {
      progress = await db.progress.findMany({
        where: { userId: user!.id, lesson: { courseId: id } },
        select: {
          lessonId: true,
          status: true,
          timeSpent: true,
          completedAt: true,
        },
      });
    }

    return NextResponse.json({ course, enrollment, progress });
  } catch (error) {
    console.error("Get course error:", error);
    return NextResponse.json({ error: "Kesalahan server" }, { status: 500 });
  }
}

// PUT /api/courses/[id] — Update course
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
    }

    const course = await db.course.findUnique({ where: { id } });
    if (!course) {
      return NextResponse.json({ error: "Kursus tidak ditemukan" }, { status: 404 });
    }

    // Only instructor who created or admin can update
    const isOwner = course.instructorId === user.id;
    const isAdmin = user.tenants.some(
      (t) => t.tenantId === course.tenantId && (t.role === "ADMIN" || t.role === "SUPER_ADMIN")
    );
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: "Tidak berwenang" }, { status: 403 });
    }

    const body = await req.json();
    const { title, description, thumbnail, category, tags, status, isFree, maxStudents, enrollStart, enrollEnd } = body;

    const updated = await db.course.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(thumbnail !== undefined && { thumbnail }),
        ...(category !== undefined && { category }),
        ...(tags !== undefined && { tags }),
        ...(status !== undefined && { status }),
        ...(isFree !== undefined && { isFree }),
        ...(maxStudents !== undefined && { maxStudents }),
        ...(enrollStart !== undefined && { enrollStart: enrollStart ? new Date(enrollStart) : null }),
        ...(enrollEnd !== undefined && { enrollEnd: enrollEnd ? new Date(enrollEnd) : null }),
      },
    });

    return NextResponse.json({ course: updated });
  } catch (error) {
    console.error("Update course error:", error);
    return NextResponse.json({ error: "Kesalahan server" }, { status: 500 });
  }
}

// DELETE /api/courses/[id] — Delete course
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
    }

    const course = await db.course.findUnique({ where: { id } });
    if (!course) {
      return NextResponse.json({ error: "Kursus tidak ditemukan" }, { status: 404 });
    }

    const isOwner = course.instructorId === user.id;
    const isAdmin = user.tenants.some(
      (t) => t.tenantId === course.tenantId && (t.role === "ADMIN" || t.role === "SUPER_ADMIN")
    );
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: "Tidak berwenang" }, { status: 403 });
    }

    await db.course.delete({ where: { id } });

    return NextResponse.json({ message: "Kursus berhasil dihapus" });
  } catch (error) {
    console.error("Delete course error:", error);
    return NextResponse.json({ error: "Kesalahan server" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";

// GET /api/courses/[id]/lessons — List lessons for a course
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: courseId } = await params;

    const lessons = await db.lesson.findMany({
      where: { courseId },
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
    });

    return NextResponse.json({ lessons });
  } catch (error) {
    console.error("List lessons error:", error);
    return NextResponse.json({ error: "Kesalahan server" }, { status: 500 });
  }
}

// POST /api/courses/[id]/lessons — Create a lesson
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: courseId } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
    }

    const course = await db.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return NextResponse.json({ error: "Kursus tidak ditemukan" }, { status: 404 });
    }

    // Authorization: owner or admin
    const isOwner = course.instructorId === user.id;
    const isAdmin = user.tenants.some(
      (t) => t.tenantId === course.tenantId && (t.role === "ADMIN" || t.role === "SUPER_ADMIN")
    );
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: "Tidak berwenang" }, { status: 403 });
    }

    const body = await req.json();
    const { title, description, duration, isFree, classroomId, classroomData } = body;

    if (!title) {
      return NextResponse.json({ error: "Judul pelajaran wajib diisi" }, { status: 400 });
    }

    // Get next order number
    const lastLesson = await db.lesson.findFirst({
      where: { courseId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const nextOrder = (lastLesson?.order ?? 0) + 1;

    const lesson = await db.lesson.create({
      data: {
        courseId,
        title,
        description: description || null,
        order: nextOrder,
        duration: duration || null,
        isFree: isFree || false,
        classroomId: classroomId || null,
        classroomData: classroomData || null,
      },
    });

    // Create progress records for all currently enrolled students
    const enrollments = await db.enrollment.findMany({
      where: { courseId, status: "ACTIVE" },
      select: { userId: true },
    });

    if (enrollments.length > 0) {
      await db.progress.createMany({
        data: enrollments.map((e) => ({
          userId: e.userId,
          lessonId: lesson.id,
          status: "NOT_STARTED" as const,
        })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json({ lesson }, { status: 201 });
  } catch (error) {
    console.error("Create lesson error:", error);
    return NextResponse.json({ error: "Kesalahan server" }, { status: 500 });
  }
}

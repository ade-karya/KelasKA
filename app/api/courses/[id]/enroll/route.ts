import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";

// POST /api/courses/[id]/enroll — Enroll in a course
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

    if (course.status !== "PUBLISHED") {
      return NextResponse.json({ error: "Kursus belum dipublikasikan" }, { status: 400 });
    }

    // Check enrollment period
    const now = new Date();
    if (course.enrollStart && now < course.enrollStart) {
      return NextResponse.json({ error: "Pendaftaran belum dibuka" }, { status: 400 });
    }
    if (course.enrollEnd && now > course.enrollEnd) {
      return NextResponse.json({ error: "Pendaftaran sudah ditutup" }, { status: 400 });
    }

    // Check capacity
    if (course.maxStudents) {
      const enrolledCount = await db.enrollment.count({
        where: { courseId, status: "ACTIVE" },
      });
      if (enrolledCount >= course.maxStudents) {
        return NextResponse.json({ error: "Kursus sudah penuh" }, { status: 400 });
      }
    }

    // Check if already enrolled
    const existing = await db.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId } },
    });
    if (existing) {
      return NextResponse.json({ error: "Sudah terdaftar di kursus ini" }, { status: 400 });
    }

    // Create enrollment
    const enrollment = await db.enrollment.create({
      data: {
        userId: user.id,
        courseId,
        status: "ACTIVE",
      },
    });

    // Create initial progress for all lessons
    const lessons = await db.lesson.findMany({
      where: { courseId },
      select: { id: true },
    });

    if (lessons.length > 0) {
      await db.progress.createMany({
        data: lessons.map((lesson) => ({
          userId: user.id,
          lessonId: lesson.id,
          status: "NOT_STARTED" as const,
        })),
        skipDuplicates: true,
      });
    }

    // Create notification for the student
    await db.notification.create({
      data: {
        userId: user.id,
        title: "Pendaftaran Berhasil",
        message: `Anda berhasil mendaftar di kursus "${course.title}"`,
        type: "enrollment",
        link: `/courses/${courseId}`,
      },
    });

    return NextResponse.json({ enrollment }, { status: 201 });
  } catch (error) {
    console.error("Enroll error:", error);
    return NextResponse.json({ error: "Kesalahan server" }, { status: 500 });
  }
}

// DELETE /api/courses/[id]/enroll — Unenroll from a course
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: courseId } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
    }

    const enrollment = await db.enrollment.findUnique({
      where: { userId_courseId: { userId: user.id, courseId } },
    });

    if (!enrollment) {
      return NextResponse.json({ error: "Belum terdaftar di kursus ini" }, { status: 404 });
    }

    await db.enrollment.update({
      where: { id: enrollment.id },
      data: { status: "DROPPED" },
    });

    return NextResponse.json({ message: "Berhasil keluar dari kursus" });
  } catch (error) {
    console.error("Unenroll error:", error);
    return NextResponse.json({ error: "Kesalahan server" }, { status: 500 });
  }
}

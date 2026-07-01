import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";

// GET /api/dashboard — Get dashboard stats and enrolled courses
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
    }

    // Get all active enrollments
    const enrollments = await db.enrollment.findMany({
      where: { userId: user.id, status: { in: ["ACTIVE", "COMPLETED"] } },
      include: {
        course: {
          include: {
            _count: { select: { lessons: true } },
          },
        },
      },
    });

    // Get progress for all enrolled courses
    const courseIds = enrollments.map((e) => e.courseId);
    const allProgress = await db.progress.findMany({
      where: {
        userId: user.id,
        lesson: { courseId: { in: courseIds } },
      },
      select: {
        lessonId: true,
        status: true,
        timeSpent: true,
        lesson: { select: { courseId: true } },
      },
    });

    // Build enrolled courses with progress
    const enrolledCourses = enrollments.map((enrollment) => {
      const courseProgress = allProgress.filter(
        (p) => p.lesson.courseId === enrollment.courseId
      );
      const completedLessons = courseProgress.filter(
        (p) => p.status === "COMPLETED"
      ).length;
      const totalTimeSpent = courseProgress.reduce(
        (sum, p) => sum + p.timeSpent,
        0
      );

      return {
        id: enrollment.course.id,
        title: enrollment.course.title,
        description: enrollment.course.description,
        thumbnail: enrollment.course.thumbnail,
        category: enrollment.course.category,
        _count: enrollment.course._count,
        completedLessons,
        totalTimeSpent,
      };
    });

    // Calculate stats
    const totalTimeSpent = allProgress.reduce((sum, p) => sum + p.timeSpent, 0);
    const completedCourses = enrollments.filter((e) => e.status === "COMPLETED").length;

    const stats = {
      totalCourses: enrollments.length,
      completedCourses,
      totalTimeSpent,
      currentStreak: 0, // TODO: implement streak calculation
    };

    return NextResponse.json({ enrolledCourses, stats });
  } catch (error) {
    console.error("Dashboard error:", error);
    return NextResponse.json({ error: "Kesalahan server" }, { status: 500 });
  }
}

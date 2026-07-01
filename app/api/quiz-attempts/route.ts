import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth/session';

// POST /api/quiz-attempts — Save a completed quiz attempt for a classroom/lesson
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum masuk' }, { status: 401 });
    }

    const { classroomId, correct, total, answers } = await req.json();

    if (!classroomId) {
      return NextResponse.json({ error: 'classroomId wajib diisi' }, { status: 400 });
    }

    // Find the lesson associated with this classroom
    const lesson = await db.lesson.findFirst({
      where: { classroomId },
      select: { id: true, courseId: true },
    });

    if (!lesson) {
      return NextResponse.json({ error: 'Pelajaran tidak ditemukan untuk classroom ini' }, { status: 404 });
    }

    // Save the quiz attempt
    const attempt = await db.quizAttempt.create({
      data: {
        userId: user.id,
        lessonId: lesson.id,
        score: parseFloat(correct || 0),
        maxScore: parseFloat(total || 0),
        answers: answers || {},
      },
    });

    // Automatically mark the progress for this lesson as completed!
    await db.progress.upsert({
      where: {
        userId_lessonId: {
          userId: user.id,
          lessonId: lesson.id,
        },
      },
      update: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
      create: {
        userId: user.id,
        lessonId: lesson.id,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    // Check if all lessons for this course are completed by this user
    const courseLessons = await db.lesson.findMany({
      where: { courseId: lesson.courseId },
      select: { id: true },
    });

    const completedProgressCount = await db.progress.count({
      where: {
        userId: user.id,
        lesson: { courseId: lesson.courseId },
        status: 'COMPLETED',
      },
    });

    if (courseLessons.length > 0 && completedProgressCount === courseLessons.length) {
      // Mark enrollment as COMPLETED
      await db.enrollment.updateMany({
        where: {
          userId: user.id,
          courseId: lesson.courseId,
          status: 'ACTIVE',
        },
        data: {
          status: 'COMPLETED',
        },
      });

      // Generate a Certificate automatically!
      await db.certificate.upsert({
        where: {
          userId_courseId: {
            userId: user.id,
            courseId: lesson.courseId,
          },
        },
        update: {},
        create: {
          userId: user.id,
          courseId: lesson.courseId,
        },
      });

      // Create notification
      await db.notification.create({
        data: {
          userId: user.id,
          title: 'Selamat! Kursus Selesai',
          message: `Anda telah menyelesaikan seluruh pelajaran. Sertifikat Anda telah terbit!`,
          type: 'grade',
          link: `/courses/${lesson.courseId}`,
        },
      });
    }

    return NextResponse.json({ success: true, attempt });
  } catch (error) {
    console.error('Quiz attempt save error:', error);
    return NextResponse.json({ error: 'Kesalahan server' }, { status: 500 });
  }
}

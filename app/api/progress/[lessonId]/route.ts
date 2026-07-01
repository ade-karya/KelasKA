import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";

// PUT /api/progress/[lessonId] — Update lesson progress
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  try {
    const { lessonId } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
    }

    const body = await req.json();
    const { status, timeSpent } = body;

    const progress = await db.progress.upsert({
      where: {
        userId_lessonId: {
          userId: user.id,
          lessonId,
        },
      },
      update: {
        ...(status && { status }),
        ...(timeSpent && { timeSpent: { increment: timeSpent } }),
        lastAccess: new Date(),
        ...(status === "COMPLETED" && { completedAt: new Date() }),
      },
      create: {
        userId: user.id,
        lessonId,
        status: status || "IN_PROGRESS",
        timeSpent: timeSpent || 0,
      },
    });

    return NextResponse.json({ progress });
  } catch (error) {
    console.error("Update progress error:", error);
    return NextResponse.json({ error: "Kesalahan server" }, { status: 500 });
  }
}

// GET /api/progress/[lessonId] — Get lesson progress
export async function GET(
  req: Request,
  { params }: { params: Promise<{ lessonId: string }> }
) {
  try {
    const { lessonId } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
    }

    const progress = await db.progress.findUnique({
      where: {
        userId_lessonId: {
          userId: user.id,
          lessonId,
        },
      },
    });

    return NextResponse.json({ progress });
  } catch (error) {
    console.error("Get progress error:", error);
    return NextResponse.json({ error: "Kesalahan server" }, { status: 500 });
  }
}

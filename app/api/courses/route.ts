import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getUserPrimaryTenantId } from "@/lib/auth/session";

// GET /api/courses — List courses for the current user's tenant
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || (await getUserPrimaryTenantId(user.id));
    const status = searchParams.get("status") || undefined;
    const category = searchParams.get("category") || undefined;
    const search = searchParams.get("search") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    if (!tenantId) {
      return NextResponse.json({ error: "Tenant tidak ditemukan" }, { status: 400 });
    }

    const where: any = { tenantId };
    if (status) where.status = status;
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const [courses, total] = await Promise.all([
      db.course.findMany({
        where,
        include: {
          _count: { select: { lessons: true, enrollments: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.course.count({ where }),
    ]);

    return NextResponse.json({
      courses,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("List courses error:", error);
    return NextResponse.json({ error: "Kesalahan server" }, { status: 500 });
  }
}

// POST /api/courses — Create a new course
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
    }

    // Check if user is instructor or admin
    const isInstructor = user.tenants.some(
      (t) => t.role === "INSTRUCTOR" || t.role === "ADMIN" || t.role === "SUPER_ADMIN"
    );
    if (!isInstructor) {
      return NextResponse.json({ error: "Hanya instructor yang dapat membuat kursus" }, { status: 403 });
    }

    const body = await req.json();
    const { title, description, thumbnail, category, tags, tenantId: bodyTenantId, isFree, maxStudents } = body;

    if (!title) {
      return NextResponse.json({ error: "Judul kursus wajib diisi" }, { status: 400 });
    }

    const tenantId = bodyTenantId || (await getUserPrimaryTenantId(user.id));
    if (!tenantId) {
      return NextResponse.json({ error: "Tenant tidak ditemukan" }, { status: 400 });
    }

    // Verify user belongs to this tenant with correct role
    const membership = user.tenants.find((t) => t.tenantId === tenantId);
    if (!membership || membership.role === "STUDENT") {
      return NextResponse.json({ error: "Tidak berwenang untuk tenant ini" }, { status: 403 });
    }

    const course = await db.course.create({
      data: {
        tenantId,
        instructorId: user.id,
        title,
        description: description || null,
        thumbnail: thumbnail || null,
        category: category || null,
        tags: tags || [],
        isFree: isFree !== false,
        maxStudents: maxStudents || null,
      },
    });

    return NextResponse.json({ course }, { status: 201 });
  } catch (error) {
    console.error("Create course error:", error);
    return NextResponse.json({ error: "Kesalahan server" }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/certificates/verify/[code] — Verify a certificate authenticity
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    const certificate = await db.certificate.findUnique({
      where: { verificationCode: code },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        course: {
          select: {
            title: true,
            description: true,
            tenant: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!certificate) {
      return NextResponse.json(
        { success: false, error: 'Sertifikat tidak valid atau tidak ditemukan' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      certificate: {
        verificationCode: certificate.verificationCode,
        issuedAt: certificate.issuedAt,
        studentName: certificate.user.name,
        courseTitle: certificate.course.title,
        organizationName: certificate.course.tenant.name,
      },
    });
  } catch (error) {
    console.error('Verify certificate error:', error);
    return NextResponse.json({ error: 'Kesalahan server' }, { status: 500 });
  }
}

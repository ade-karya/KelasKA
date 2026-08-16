import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSupabaseServer } from '@/lib/supabase/server';
import { signStudentToken } from '@/lib/auth/jwt';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('Student Login');

interface LoginRequest {
  nisn: string;
  password: string;
}

export async function POST(req: NextRequest) {
  let nisn: string | undefined;
  try {
    const body = (await req.json()) as LoginRequest;
    nisn = body?.nisn?.trim();
    const password = body?.password;

    if (!nisn || !password) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'nisn and password are required');
    }

    const { data: student, error } = await getSupabaseServer()
      .from('students')
      .select('id, name, nim, nisn, class_name, avatar_url, password_hash')
      .eq('nisn', nisn)
      .maybeSingle();

    if (error) {
      log.error('Failed to query student by nisn:', error);
      return apiError('INTERNAL_ERROR', 500, 'Failed to query student');
    }

    if (!student?.password_hash || !(await bcrypt.compare(password, student.password_hash))) {
      return apiError('INVALID_CREDENTIALS', 401, 'NISN atau kata sandi salah');
    }

    const token = await signStudentToken({
      sub: student.id,
      nisn: student.nisn as string,
      role: 'student',
    });

    return apiSuccess({
      token,
      student: {
        id: student.id,
        name: student.name,
        nim: student.nim,
        nisn: student.nisn,
        class_name: student.class_name,
        avatar_url: student.avatar_url,
      },
    });
  } catch (error) {
    log.error(`Student login failed [nisn="${nisn ?? 'unknown'}"]:`, error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to sign in');
  }
}
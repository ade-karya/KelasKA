import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getAuthenticatedStudent } from '@/lib/auth/student-session';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('Student Change Password');

interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthenticatedStudent(req);
    if (!auth) return apiError('INVALID_CREDENTIALS', 401, 'Silakan masuk terlebih dahulu');

    const body = (await req.json()) as ChangePasswordRequest;
    const { oldPassword, newPassword } = body;

    if (!oldPassword || !newPassword) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'oldPassword and newPassword are required');
    }
    if (newPassword.length < 6) {
      return apiError('INVALID_REQUEST', 400, 'Kata sandi baru minimal 6 karakter');
    }

    const { data: student, error: fetchError } = await getSupabaseServer()
      .from('students')
      .select('password_hash')
      .eq('id', auth.student.id)
      .maybeSingle();

    if (fetchError || !student?.password_hash) {
      return apiError('INTERNAL_ERROR', 500, 'Failed to load student credentials');
    }

    const matches = await bcrypt.compare(oldPassword, student.password_hash);
    if (!matches) {
      return apiError('INVALID_CREDENTIALS', 401, 'Kata sandi lama salah');
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    const { error: updateError } = await getSupabaseServer()
      .from('students')
      .update({ password_hash: newHash })
      .eq('id', auth.student.id);

    if (updateError) {
      log.error('Failed to update student password:', updateError);
      return apiError('INTERNAL_ERROR', 500, 'Failed to update password');
    }

    return apiSuccess({ ok: true });
  } catch (error) {
    log.error('Student change-password failed:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to change password');
  }
}
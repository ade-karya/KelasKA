import { NextRequest } from 'next/server';
import { getAuthenticatedStudent } from '@/lib/auth/student-session';
import { apiError, apiSuccess } from '@/lib/server/api-response';

export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedStudent(req);
  if (!auth) return apiError('INVALID_CREDENTIALS', 401, 'Silakan masuk terlebih dahulu');
  return apiSuccess({ student: auth.student });
}
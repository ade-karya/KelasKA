import type { NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { verifyStudentToken, type StudentTokenPayload } from '@/lib/auth/jwt';

export interface StudentProfile {
  id: string;
  name: string;
  nim: string | null;
  nisn: string | null;
  class_name: string | null;
  avatar_url: string | null;
  tenant_id?: string | null;
}

export interface AuthenticatedStudent {
  token: string;
  student: StudentProfile;
}

export function extractBearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

export async function getAuthenticatedStudent(
  req: NextRequest,
): Promise<AuthenticatedStudent | null> {
  const token = extractBearerToken(req);
  if (!token) return null;
  const payload: StudentTokenPayload | null = await verifyStudentToken(token);
  if (!payload) return null;

  // tahan terhadap projek yang belum menjalankan migrasi enterprise (kolom tenant_id belum ada)
  let data: any = null;
  let error: any = null;
  try {
    const res = await getSupabaseServer()
      .from('students')
      .select('id, name, nim, nisn, class_name, avatar_url, tenant_id, average_score')
      .eq('id', payload.sub)
      .maybeSingle();
    data = res.data;
    error = res.error;
    if (error && String(error.message || '').includes('tenant_id')) {
      const fallback = await getSupabaseServer()
        .from('students')
        .select('id, name, nim, nisn, class_name, avatar_url, average_score')
        .eq('id', payload.sub)
        .maybeSingle();
      data = fallback.data;
      error = fallback.error;
      if (data) (data as any).tenant_id = '00000000-0000-0000-0000-000000000001';
    }
  } catch {
    return null;
  }

  if (error || !data) return null;
  return { token, student: data as unknown as StudentProfile };
}
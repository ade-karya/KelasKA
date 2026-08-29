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

  const { data, error } = await getSupabaseServer()
    .from('students')
    .select('id, name, nim, nisn, class_name, avatar_url')
    .eq('id', payload.sub)
    .maybeSingle();

  if (error || !data) return null;
  return { token, student: data as unknown as StudentProfile };
}
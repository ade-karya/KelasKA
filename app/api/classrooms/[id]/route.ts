import { NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getAuthenticatedStudent, extractBearerToken } from '@/lib/auth/student-session';
import { apiError, apiSuccess } from '@/lib/server/api-response';

const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';
export const runtime = 'nodejs';

async function resolveAuth(req: NextRequest) {
  const studentAuth = await getAuthenticatedStudent(req).catch(()=>null);
  if (studentAuth?.student) return { role:'siswa' as const, tenantId:(studentAuth.student as any).tenant_id ?? DEFAULT_TENANT, student:studentAuth.student, className:(studentAuth.student as any).class_name };
  const bearer = extractBearerToken(req);
  if (bearer) {
    try {
      const { data } = await getSupabaseServer().auth.getUser(bearer);
      const user = data?.user;
      if (user) {
        const { data: profile } = await getSupabaseServer().from('profiles').select('tenant_id, role, class_names').eq('id', user.id).maybeSingle();
        if (profile && ['teacher','admin'].includes((profile as any).role)) return { role:(profile as any).role==='admin'?'admin':'guru' as const, tenantId:(profile as any).tenant_id, profile:profile as any, user };
        if (profile) return null;
        return { role:'guru' as const, tenantId:DEFAULT_TENANT, user };
      }
    } catch {}
  }
  return null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  const auth = await resolveAuth(req);
  if (!auth) {
    if (isProduction) return apiError('UNAUTHENTICATED', 401, 'Auth diperlukan');
    return apiError('UNAUTHENTICATED', 401, 'Auth diperlukan');
  }
  const supa = getSupabaseServer();
  const { data: room, error } = await supa.from('classrooms').select('*').eq('id', id).maybeSingle();
  if (error || !room) return apiError('INVALID_REQUEST', 404, 'Classroom tidak ditemukan');
  if ((room as any).tenant_id !== auth.tenantId) return apiError('FORBIDDEN', 403, 'Tidak diizinkan: tenant berbeda');
  // gate: siswa hanya published + assigned
  if (auth.role === 'siswa') {
    if ((room as any).status !== 'published') return apiError('FORBIDDEN', 403, 'Materi belum dipublish');
    const { data: assign } = await supa.from('classroom_assignments').select('id').eq('classroom_id', id).eq('class_name', (auth as any).className || '').eq('tenant_id', auth.tenantId).maybeSingle();
    if (!assign) return apiError('FORBIDDEN', 403, 'Tidak diizinkan: kelas Anda tidak di-assign materi ini');
  } else {
    // guru: boleh lihat draft miliknya atau published assigned ke kelas ampu
    if ((room as any).status === 'draft' || (room as any).status === 'in_review') {
      const isOwner = (room as any).created_by === (auth as any).user?.id;
      const isAdmin = auth.role === 'admin';
      if (!isOwner && !isAdmin) return apiError('FORBIDDEN', 403, 'Hanya pemilik draft atau admin yang dapat melihat');
    }
    if ((room as any).status === 'published' && auth.role === 'guru') {
      const allowed = (auth as any).profile?.class_names || [];
      if (allowed.length) {
        const { data: assigns } = await supa.from('classroom_assignments').select('class_name').eq('classroom_id', id);
        const assignedClasses = (assigns || []).map((a:any)=>a.class_name);
        const hasOverlap = assignedClasses.some((c:string)=> allowed.includes(c));
        const isOwner = (room as any).created_by === (auth as any).user?.id;
        if (!hasOverlap && !isOwner) return apiError('FORBIDDEN', 403, 'Tidak diizinkan: bukan kelas ampu Anda');
      }
    }
  }
  return apiSuccess({ classroom: room });
}

// PATCH update title/status (for review flow)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await resolveAuth(req);
  if (!auth || (auth.role !== 'guru' && auth.role !== 'admin')) return apiError('UNAUTHENTICATED', 401, 'Hanya guru');
  let body:any; try { body = await req.json(); } catch { return apiError('INVALID_REQUEST',400,'invalid JSON'); }
  const supa = getSupabaseServer();
  const { data: room } = await supa.from('classrooms').select('*').eq('id', id).maybeSingle();
  if (!room || (room as any).tenant_id !== auth.tenantId) return apiError('INVALID_REQUEST',404,'Tidak ditemukan');
  const isOwner = (room as any).created_by === (auth as any).user?.id;
  if (!isOwner && auth.role !== 'admin') return apiError('FORBIDDEN',403,'Hanya pemilik');
  const updates:any = {};
  if (typeof body.title === 'string') updates.title = body.title.trim();
  if (typeof body.status === 'string' && ['draft','in_review','published','archived'].includes(body.status)) {
    updates.status = body.status;
    updates.updated_at = new Date().toISOString();
    if (body.status === 'published') updates.published_at = new Date().toISOString();
  }
  if (Object.keys(updates).length===0) return apiError('INVALID_REQUEST',400,'Tidak ada perubahan');
  const { data, error } = await supa.from('classrooms').update(updates).eq('id', id).select().single();
  if (error) return apiError('INTERNAL_ERROR',500, error.message);
  return apiSuccess({ classroom: data });
}

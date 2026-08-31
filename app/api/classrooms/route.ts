import { NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getAuthenticatedStudent, extractBearerToken } from '@/lib/auth/student-session';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('classrooms');
const DEFAULT_TENANT = '00000000-0000-0000-0000-000000000001';
export const runtime = 'nodejs';

async function resolveAuth(req: NextRequest) {
  const studentAuth = await getAuthenticatedStudent(req).catch(() => null);
  if (studentAuth?.student) {
    return {
      role: 'siswa' as const,
      tenantId: (studentAuth.student as any).tenant_id ?? DEFAULT_TENANT,
      student: studentAuth.student,
      className: (studentAuth.student as any).class_name ?? null,
      profile: null,
    };
  }
  const bearer = extractBearerToken(req);
  if (bearer) {
    try {
      const { data } = await getSupabaseServer().auth.getUser(bearer);
      const user = data?.user;
      if (user) {
        const { data: profile } = await getSupabaseServer().from('profiles').select('tenant_id, role, class_names').eq('id', user.id).maybeSingle();
        if (profile && ['teacher','admin'].includes((profile as any).role)) {
          return {
            role: (profile as any).role === 'admin' ? 'admin' as const : 'guru' as const,
            tenantId: (profile as any).tenant_id,
            student: null,
            className: null,
            profile: profile as any,
            user,
          };
        }
        if (profile) return null;
        // fallback single-tenant
        return { role: 'guru' as const, tenantId: DEFAULT_TENANT, student: null, className: null, profile: null, user };
      }
    } catch {}
  }
  return null;
}

// GET /api/classrooms — list visible classrooms for caller
// Siswa: only published + assigned to their class_name, same tenant
// Guru: draft miliknya + published assigned ke kelas ampu (or all if admin)
export async function GET(req: NextRequest) {
  const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  const auth = await resolveAuth(req);
  if (!auth) {
    if (isProduction) return apiError('UNAUTHENTICATED', 401, 'Auth diperlukan');
    // dev allow empty? return empty for landing preview
    return apiSuccess({ classrooms: [] });
  }
  const supa = getSupabaseServer();
  try {
    if (auth.role === 'siswa') {
      // published + assigned
      const { data: assignments } = await supa.from('classroom_assignments').select('classroom_id').eq('tenant_id', auth.tenantId).eq('class_name', auth.className || '');
      const ids = (assignments || []).map((a:any)=>a.classroom_id);
      if (ids.length === 0) return apiSuccess({ classrooms: [] });
      const { data: rooms } = await supa.from('classrooms').select('*').in('id', ids).eq('tenant_id', auth.tenantId).eq('status','published').order('published_at', {ascending:false});
      return apiSuccess({ classrooms: rooms || [] });
    } else {
      // guru/admin
      let q:any = supa.from('classrooms').select('*').eq('tenant_id', auth.tenantId).order('created_at', { ascending: false }).limit(50);
      // teacher scoped: show own drafts + anything assigned to their classes + all published? For now show all tenant classrooms
      // If teacher (not admin) filter: either created_by = my id OR status published with assignment to allowed classes
      if (auth.role === 'guru' && auth.profile?.class_names?.length) {
        // fetch all then filter in code to avoid complex join
        const { data: all } = await q;
        const allowed = new Set(auth.profile.class_names);
        // fetch assignments for published rooms
        const publishedIds = (all || []).filter((r:any)=>r.status==='published').map((r:any)=>r.id);
        let assignedMap = new Map<string, string[]>();
        if (publishedIds.length) {
          const { data: assigns } = await supa.from('classroom_assignments').select('classroom_id, class_name').in('classroom_id', publishedIds);
          for (const a of assigns || []) {
            const arr = assignedMap.get(a.classroom_id) || [];
            arr.push(a.class_name);
            assignedMap.set(a.classroom_id, arr);
          }
        }
        const filtered = (all || []).filter((r:any)=>{
          if (r.created_by === (auth as any).user?.id) return true;
          if (r.status === 'published') {
            const cls = assignedMap.get(r.id) || [];
            return cls.some(c=> allowed.has(c));
          }
          return false;
        });
        return apiSuccess({ classrooms: filtered });
      }
      const { data } = await q;
      return apiSuccess({ classrooms: data || [] });
    }
  } catch (e) {
    log.error('classrooms GET failed', e);
    return apiError('INTERNAL_ERROR', 500, 'Gagal memuat classrooms');
  }
}

// POST /api/classrooms — create draft (guru only)
export async function POST(req: NextRequest) {
  const auth = await resolveAuth(req);
  if (!auth || (auth.role !== 'guru' && auth.role !== 'admin')) {
    return apiError('UNAUTHENTICATED', 401, 'Hanya guru yang dapat membuat kelas');
  }
  let body:any;
  try { body = await req.json(); } catch { return apiError('INVALID_REQUEST', 400, 'invalid JSON'); }
  const title = (body.title || body.name || '').trim();
  if (!title) return apiError('MISSING_REQUIRED_FIELD', 400, 'title wajib');
  const status = 'draft';
  const supa = getSupabaseServer();
  try {
    const { data, error } = await supa.from('classrooms').insert([{
      tenant_id: auth.tenantId,
      created_by: (auth as any).user?.id ?? null,
      title,
      status,
      language: body.language || 'id-ID',
      stage_payload_path: body.stage_payload_path || null,
    }]).select().single();
    if (error) throw error;
    await supa.from('user_activity_logs').insert([{ tenant_id: auth.tenantId, user_id: (auth as any).user?.id, action: 'classroom.create', details: { classroom_id: (data as any).id, title } }]).then(()=>{}).catch(()=>{});
    return apiSuccess({ classroom: data }, 201);
  } catch (e:any) {
    log.error('classrooms POST failed', e);
    return apiError('INTERNAL_ERROR', 500, e.message || 'Gagal membuat classroom');
  }
}

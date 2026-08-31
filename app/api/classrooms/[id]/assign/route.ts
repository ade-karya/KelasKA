import { NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { extractBearerToken } from '@/lib/auth/student-session';
import { apiError, apiSuccess } from '@/lib/server/api-response';
const DEFAULT_TENANT='00000000-0000-0000-0000-000000000001';
export const runtime='nodejs';
async function resolveAuth(req:NextRequest){
  const bearer=extractBearerToken(req);
  if(bearer){ try{ const {data}=await getSupabaseServer().auth.getUser(bearer); const user=data?.user; if(user){ const {data:profile}=await getSupabaseServer().from('profiles').select('tenant_id, role, class_names').eq('id',user.id).maybeSingle(); if(profile && ['teacher','admin'].includes((profile as any).role)) return {role:(profile as any).role==='admin'?'admin':'guru' as const, tenantId:(profile as any).tenant_id, profile:profile as any, user}; if(profile) return null; return {role:'guru' as const, tenantId:DEFAULT_TENANT, profile:{class_names:[]}, user}; } }catch{} }
  return null;
}
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const auth=await resolveAuth(req);
  if(!auth||(auth.role!=='guru'&&auth.role!=='admin')) return apiError('UNAUTHENTICATED',401,'Hanya guru');
  let body:any; try{ body=await req.json(); }catch{ return apiError('INVALID_REQUEST',400,'invalid JSON'); }
  const classNames: string[] = body.class_names || body.classNames || [];
  if(!Array.isArray(classNames) || classNames.length===0) return apiError('MISSING_REQUIRED_FIELD',400,'class_names wajib');
  const supa=getSupabaseServer();
  const {data:room}=await supa.from('classrooms').select('*').eq('id',id).maybeSingle();
  if(!room||(room as any).tenant_id!==auth.tenantId) return apiError('INVALID_REQUEST',404,'Tidak ditemukan');
  if((room as any).status!=='published') return apiError('INVALID_REQUEST',400,'Hanya classroom published yang bisa di-assign');
  // enforce class_names subset of teacher's allowed (admin boleh semua)
  if(auth.role==='guru'){
    const allowed = new Set(auth.profile?.class_names || []);
    for(const c of classNames){ if(!allowed.has(c)) return apiError('UNAUTHENTICATED',403,`Kelas ${c} bukan kelas ampu Anda`); }
  }
  const rows = classNames.map(c=>({ tenant_id: auth.tenantId, classroom_id: id, class_name: c, assigned_by: auth.user.id }));
  const { error } = await supa.from('classroom_assignments').upsert(rows, { onConflict:'classroom_id,class_name', ignoreDuplicates:false });
  if(error) return apiError('INTERNAL_ERROR',500,error.message);
  await supa.from('user_activity_logs').insert([{tenant_id:auth.tenantId, user_id:auth.user.id, action:'classroom.assign', details:{classroom_id:id, class_names:classNames}}]).catch(()=>{});
  return apiSuccess({ assigned: classNames });
}
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const auth=await resolveAuth(req);
  if(!auth) return apiError('UNAUTHENTICATED',401,'Auth diperlukan');
  const supa=getSupabaseServer();
  const {data}=await supa.from('classroom_assignments').select('*').eq('classroom_id',id).eq('tenant_id',auth.tenantId);
  return apiSuccess({ assignments: data || [] });
}

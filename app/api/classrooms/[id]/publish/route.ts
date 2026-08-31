import { NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getAuthenticatedStudent, extractBearerToken } from '@/lib/auth/student-session';
import { apiError, apiSuccess } from '@/lib/server/api-response';
const DEFAULT_TENANT='00000000-0000-0000-0000-000000000001';
export const runtime='nodejs';
async function resolveAuth(req:NextRequest){
  const bearer=extractBearerToken(req);
  if(bearer){ try{ const {data}=await getSupabaseServer().auth.getUser(bearer); const user=data?.user; if(user){ const {data:profile}=await getSupabaseServer().from('profiles').select('tenant_id, role').eq('id',user.id).maybeSingle(); if(profile && ['teacher','admin'].includes((profile as any).role)) return {role:(profile as any).role==='admin'?'admin':'guru' as const, tenantId:(profile as any).tenant_id, user}; if(profile) return null; return {role:'guru' as const, tenantId:DEFAULT_TENANT, user}; } }catch{} }
  return null;
}
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  const auth=await resolveAuth(req);
  if(!auth||(auth.role!=='guru'&&auth.role!=='admin')) return apiError('UNAUTHENTICATED',401,'Hanya guru');
  const supa=getSupabaseServer();
  const {data:room}=await supa.from('classrooms').select('*').eq('id',id).maybeSingle();
  if(!room||(room as any).tenant_id!==auth.tenantId) return apiError('INVALID_REQUEST',404,'Tidak ditemukan');
  if((room as any).created_by !== auth.user.id && auth.role!=='admin') return apiError('FORBIDDEN',403,'Hanya pemilik');
  if(!['draft','in_review'].includes((room as any).status)) return apiError('INVALID_REQUEST',400,'Hanya draft/in_review yang bisa publish');
  const {data,error}=await supa.from('classrooms').update({status:'published', published_at:new Date().toISOString(), updated_at:new Date().toISOString()}).eq('id',id).select().single();
  if(error) return apiError('INTERNAL_ERROR',500,error.message);
  await supa.from('user_activity_logs').insert([{tenant_id:auth.tenantId, user_id:auth.user.id, action:'classroom.publish', details:{classroom_id:id}}]).catch(()=>{});
  return apiSuccess({classroom:data});
}

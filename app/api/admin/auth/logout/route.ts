import { NextResponse } from 'next/server';
import { ADMIN_COOKIE_NAME } from '@/lib/admin/admin-auth';

export async function POST() {
  const response = NextResponse.json({ success: true });
  
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: '',
    httpOnly: true,
    path: '/',
    maxAge: 0, // expire immediately
  });

  return response;
}

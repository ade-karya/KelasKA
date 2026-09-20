import type { NextRequest } from 'next/server';

import { apiSuccess } from '@/lib/server/api-response';
import { destroySession } from '@/lib/server/auth/session';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const cookieHeader = await destroySession(req);
  const response = apiSuccess({ loggedOut: true });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.append('Set-Cookie', cookieHeader);
  return response;
}
